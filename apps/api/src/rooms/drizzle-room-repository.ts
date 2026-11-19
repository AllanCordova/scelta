import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  auditEvents,
  ballots,
  candidates,
  members,
  participants,
  roomChatMessages,
  roomMemberCodes,
  roomRoster,
  rooms,
  roundPaperTallies,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import {
  canCastBallot,
  canJoinRoom,
  canManageRoomCandidates,
  canOpenRound,
  closeRoundOutcome,
  countOfficeRoundNumber,
  generateRoomShortCode,
  isChatRateLimited,
  isMemberEligibleVoter,
  isMultiOfficeRoomType,
  isValidOfficeForRoomType,
  isValidRoomShortCode,
  normalizeAccessCode,
  normalizeRoomShortCode,
  ROUND_RESULTS,
  tallyRoundVotes,
  validatePaperTally,
  type MemberSocietyFlags,
  type QuorumUnit,
  type RoomStatus,
  type RoomType,
  type RoundResult,
  type RoundTally,
  type RulesPreset,
} from "@scelta/domain";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { findChurchByName, getOrCreateChurch, isUniqueViolation } from "../churches/church-store.js";
import { generateAccessCode } from "./access-code.js";
import { createInviteToken } from "./invite-token.js";
import { quorumStatus } from "./quorum-status.js";
import type {
  AuditChainVerificationResult,
  JoinWithCodeResult,
  RoomRepository,
  StoredAccessCode,
  StoredAuditEvent,
  StoredCandidate,
  StoredMember,
  StoredPaperTally,
  StoredRosterEntry,
  StoredRound,
  StoredRoundStatus,
  StoredRoom,
} from "./room-repository.js";

const INVITE_TOKEN_ATTEMPTS = 8;

export function createDrizzleRoomRepository(db: Db, churchName: string): RoomRepository {
  return {
    async createRoom(room) {
      const churchId = await getOrCreateChurch(db, churchName);

      for (let attempt = 0; attempt < INVITE_TOKEN_ATTEMPTS; attempt += 1) {
        const inviteToken = createInviteToken();
        const shortCode = generateRoomShortCode((size) => randomBytes(size));
        try {
          return await db.transaction(async (tx) => {
            const churchMembers = await tx
              .select()
              .from(members)
              .where(and(eq(members.churchId, churchId), isNull(members.deletedAt)))
              .orderBy(asc(members.fullName));

            const eligibleRosterMembers = churchMembers.filter((member) =>
              isMemberEligibleVoter(
                {
                  isCommunicant: member.isCommunicant,
                  societyFlags: (member.societyFlags ?? {}) as MemberSocietyFlags,
                },
                room.roomType as RoomType,
              ),
            );
            const derivedEligibleCount =
              eligibleRosterMembers.length > 0
                ? eligibleRosterMembers.length
                : (room.eligibleCount ?? 0);

            const inserted = await tx
              .insert(rooms)
              .values({
                churchId,
                title: room.title,
                roomType: room.roomType,
                rulesPreset: room.rulesPreset,
                quorumValue: room.quorumValue,
                quorumUnit: room.quorumUnit,
                eligibleCount: derivedEligibleCount,
                inviteToken,
                shortCode,
                status: room.status,
              })
              .returning();

            const row = inserted[0];
            if (!row) {
              throw new Error("Room insert returned no row");
            }

            if (eligibleRosterMembers.length > 0) {
              await tx.insert(roomRoster).values(
                eligibleRosterMembers.map((member) => ({
                  roomId: row.id,
                  memberId: member.id,
                  fullName: member.fullName,
                  photoUrl: member.photoUrl,
                  birthDate: member.birthDate,
                  isCommunicant: member.isCommunicant,
                  isMale: member.isMale,
                  societyFlags: member.societyFlags ?? {},
                  isEligibleVoter: true,
                })),
              );
            }

            if (room.candidates && room.candidates.length > 0) {
              const memberByName = new Map(
                churchMembers.map((member) => [member.fullName.toLocaleLowerCase(), member]),
              );
              await tx.insert(candidates).values(
                room.candidates.map((displayName) => {
                  const matched = memberByName.get(displayName.toLocaleLowerCase());
                  return {
                    roomId: row.id,
                    memberId: matched?.id ?? null,
                    displayName,
                    photoUrl: matched?.photoUrl ?? null,
                    birthDate: matched?.birthDate ?? null,
                    isEligible: true,
                  };
                }),
              );
            }

            await insertAuditEvent(
              tx,
              row.id,
              "room_created",
              {
                title: row.title,
                roomType: row.roomType,
                rulesPreset: row.rulesPreset,
                quorumValue: row.quorumValue,
                quorumUnit: row.quorumUnit,
                eligibleCount: row.eligibleCount,
                status: row.status,
              },
              { churchId, roomTitle: row.title },
            );

            return toStoredRoom(row);
          });
        } catch (error) {
          if (isUniqueViolation(error) && attempt < INVITE_TOKEN_ATTEMPTS - 1) {
            continue;
          }
          throw error;
        }
      }

      throw new Error("Could not store a unique invite token");
    },

    async listRooms() {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return [];
      }

      const rows = await db
        .select()
        .from(rooms)
        .where(eq(rooms.churchId, church.id))
        .orderBy(desc(rooms.createdAt));

      return rows.map(toStoredRoom);
    },

    async findRoomByInviteToken(inviteToken) {
      const rows = await db
        .select()
        .from(rooms)
        .where(eq(rooms.inviteToken, inviteToken))
        .limit(1);
      const row = rows[0];
      return row ? toStoredRoom(row) : null;
    },

    async getJoinRoomByShortCode(shortCode) {
      const normalized = normalizeRoomShortCode(shortCode);
      if (!isValidRoomShortCode(normalized)) {
        return null;
      }
      const rows = await db
        .select()
        .from(rooms)
        .where(eq(rooms.shortCode, normalized))
        .limit(1);
      const row = rows[0];
      return row ? toStoredRoom(row) : null;
    },

    async findRoomById(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }

      const rows = await db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
        .limit(1);
      const row = rows[0];
      return row ? toStoredRoom(row) : null;
    },

    async updateRoom(roomId, input) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }

      const patch: Partial<typeof rooms.$inferInsert> = {};
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.quorumValue !== undefined) {
        patch.quorumValue = input.quorumValue;
      }
      if (input.quorumUnit !== undefined) {
        patch.quorumUnit = input.quorumUnit;
      }
      if (input.eligibleCount !== undefined) {
        patch.eligibleCount = input.eligibleCount;
      }
      if (input.status !== undefined) {
        patch.status = input.status;
      }
      if (input.reactionsEnabled !== undefined) {
        patch.reactionsEnabled = input.reactionsEnabled;
      }
      if (input.chatMuted !== undefined) {
        patch.chatMuted = input.chatMuted;
      }

      if (Object.keys(patch).length === 0) {
        return this.findRoomById(roomId);
      }

      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .limit(1);
        if (!existing) {
          return null;
        }

        const [updated] = await tx
          .update(rooms)
          .set(patch)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .returning();
        if (!updated) {
          return null;
        }

        const quorumChanged =
          existing.quorumValue !== updated.quorumValue ||
          existing.quorumUnit !== updated.quorumUnit ||
          existing.eligibleCount !== updated.eligibleCount;

        if (quorumChanged) {
          await insertAuditEvent(
            tx,
            updated.id,
            "quorum_changed",
            {
              previous: {
                quorumValue: existing.quorumValue,
                quorumUnit: existing.quorumUnit,
                eligibleCount: existing.eligibleCount,
              },
              next: {
                quorumValue: updated.quorumValue,
                quorumUnit: updated.quorumUnit,
                eligibleCount: updated.eligibleCount,
              },
            },
            { churchId: church.id, roomTitle: updated.title },
          );
        }

        if (existing.status !== updated.status) {
          await insertAuditEvent(
            tx,
            updated.id,
            "room_status_changed",
            {
              previous: existing.status,
              next: updated.status,
            },
            { churchId: church.id, roomTitle: updated.title },
          );
        }

        return toStoredRoom(updated);
      });
    },

    async rotateInviteToken(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }

      for (let attempt = 0; attempt < INVITE_TOKEN_ATTEMPTS; attempt += 1) {
        const nextToken = createInviteToken();
        try {
          return await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(rooms)
              .set({ inviteToken: nextToken })
              .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
              .returning();
            if (!updated) {
              return null;
            }
            await insertAuditEvent(
              tx,
              updated.id,
              "invite_rotated",
              {},
              { churchId: church.id, roomTitle: updated.title },
            );
            return toStoredRoom(updated);
          });
        } catch (error) {
          if (isUniqueViolation(error) && attempt < INVITE_TOKEN_ATTEMPTS - 1) {
            continue;
          }
          throw error;
        }
      }

      throw new Error("Could not store a unique invite token");
    },

    async setOfficeBanner(roomId, officeKey, bannerUrl) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }
      const existing = await this.findRoomById(roomId);
      if (!existing) {
        return null;
      }
      const nextBanners = { ...(existing.officeBanners ?? {}) };
      if (bannerUrl === null) {
        delete nextBanners[officeKey];
      } else {
        nextBanners[officeKey] = bannerUrl;
      }

      const [updated] = await db
        .update(rooms)
        .set({ officeBanners: nextBanners })
        .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
        .returning();
      return updated ? toStoredRoom(updated) : null;
    },

    async deleteRoom(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return false;
      }

      return db.transaction(async (tx) => {
        const existingRows = await tx
          .select({ id: rooms.id, title: rooms.title, status: rooms.status })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .limit(1);
        const existing = existingRows[0];
        if (!existing) {
          return false;
        }

        // Preserve audit/integrity logs permanently even when the room is deleted.
        await insertAuditEvent(
          tx,
          roomId,
          "room_deleted",
          {
            title: existing.title,
            status: existing.status,
          },
          { churchId: church.id, roomTitle: existing.title },
        );

        const roomRoundRows = await tx
          .select({ id: rounds.id })
          .from(rounds)
          .where(eq(rounds.roomId, roomId));
        const roundIds = roomRoundRows.map((round) => round.id);
        if (roundIds.length > 0) {
          await tx.delete(roundPaperTallies).where(inArray(roundPaperTallies.roundId, roundIds));
          await tx.delete(ballots).where(inArray(ballots.roundId, roundIds));
          await tx.delete(voteReceipts).where(inArray(voteReceipts.roundId, roundIds));
        }

        await tx.delete(roomChatMessages).where(eq(roomChatMessages.roomId, roomId));
        await tx.delete(rounds).where(eq(rounds.roomId, roomId));
        await tx.delete(candidates).where(eq(candidates.roomId, roomId));
        await tx.delete(participants).where(eq(participants.roomId, roomId));
        await tx.delete(roomMemberCodes).where(eq(roomMemberCodes.roomId, roomId));
        await tx.delete(roomRoster).where(eq(roomRoster.roomId, roomId));
        const deleted = await tx
          .delete(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .returning({ id: rooms.id });
        return Boolean(deleted[0]);
      });
    },

    async joinRoomWithCode(roomId, rawCode, joinKeyHash) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await db.transaction(async (tx) => {
            const roomRows = await tx
              .select({
                id: rooms.id,
                title: rooms.title,
                status: rooms.status,
                churchId: rooms.churchId,
              })
              .from(rooms)
              .where(eq(rooms.id, roomId))
              .limit(1);
            const room = roomRows[0];
            return joinParticipantInTransaction(tx, roomId, room, rawCode, joinKeyHash);
          });
        } catch (error) {
          if (!isUniqueViolation(error) || attempt === 1) {
            throw error;
          }
        }
      }
      return { ok: false as const, reason: "invalid_access_code" as const };
    },

    async joinRoomByShortCode(shortCode, rawCode, joinKeyHash) {
      const normalized = normalizeRoomShortCode(shortCode);
      if (!isValidRoomShortCode(normalized)) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await db.transaction(async (tx) => {
            const roomRows = await tx
              .select()
              .from(rooms)
              .where(eq(rooms.shortCode, normalized))
              .limit(1);
            const room = roomRows[0];
            if (!room) {
              return { ok: false as const, reason: "room_not_found" as const };
            }
            if (!canJoinRoom(room.status)) {
              return { ok: false as const, reason: "room_not_joinable" as const, status: room.status };
            }

            const result = await joinParticipantInTransaction(
              tx,
              room.id,
              { id: room.id, title: room.title, status: room.status, churchId: room.churchId },
              rawCode,
              joinKeyHash,
            );
            if (!result.ok) {
              return result;
            }
            return {
              ok: true as const,
              room: toStoredRoom(room),
              participant: result.participant,
            };
          });
        } catch (error) {
          if (!isUniqueViolation(error) || attempt === 1) {
            throw error;
          }
        }
      }
      return { ok: false as const, reason: "invalid_access_code" as const };
    },

    async generateMemberAccessCodes(roomId) {
      try {
        return await db.transaction(async (tx) => {
        const roomRows = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1)
          .for("update");
        const room = roomRows[0];
        if (!room) {
          return [];
        }

        const rosterEntries = await tx
          .select()
          .from(roomRoster)
          .where(
            and(
              eq(roomRoster.roomId, roomId),
              isNull(roomRoster.removedAt),
              eq(roomRoster.isEligibleVoter, true),
              eq(roomRoster.votesOnPaper, false),
            ),
          )
          .orderBy(asc(roomRoster.fullName), asc(roomRoster.createdAt));

        const existingCodes = await tx
          .select()
          .from(roomMemberCodes)
          .where(eq(roomMemberCodes.roomId, roomId));

        const usedCodeStrings = new Set(existingCodes.map((row) => row.code));
        const activeRosterEntryIds = new Set(
          existingCodes
            .filter((row) => row.revokedAt === null && row.rosterEntryId !== null)
            .map((row) => row.rosterEntryId as string),
        );
        const activeMemberIds = new Set(
          existingCodes
            .filter((row) => row.revokedAt === null && row.memberId !== null)
            .map((row) => row.memberId as string),
        );

        const toInsert: Array<{
          roomId: string;
          rosterEntryId: string;
          memberId: string | null;
          displayName: string;
          code: string;
          isSimulated: boolean;
        }> = [];

        for (const entry of rosterEntries) {
          if (
            activeRosterEntryIds.has(entry.id) ||
            (entry.memberId !== null && activeMemberIds.has(entry.memberId))
          ) {
            continue;
          }
          const code = allocateUniqueCode(usedCodeStrings);
          toInsert.push({
            roomId,
            rosterEntryId: entry.id,
            memberId: entry.memberId,
            displayName: entry.fullName,
            code,
            isSimulated: false,
          });
        }

        if (toInsert.length > 0) {
          await tx.insert(roomMemberCodes).values(toInsert);
        }

        const all = await tx
          .select()
          .from(roomMemberCodes)
          .where(and(eq(roomMemberCodes.roomId, roomId), eq(roomMemberCodes.isSimulated, false)))
          .orderBy(asc(roomMemberCodes.displayName), desc(roomMemberCodes.createdAt));

        return all.map(toStoredAccessCode);
        });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        return this.listAccessCodes(roomId);
      }
    },

    async createSimulatedAccessCodes(roomId, requestedCount) {
      if (requestedCount <= 0) {
        return [];
      }
      return db.transaction(async (tx) => {
        const existingCodes = await tx
          .select({ code: roomMemberCodes.code, isSimulated: roomMemberCodes.isSimulated })
          .from(roomMemberCodes)
          .where(eq(roomMemberCodes.roomId, roomId));

        const usedCodeStrings = new Set(existingCodes.map((row) => row.code));
        const existingSimCount = existingCodes.filter((row) => row.isSimulated).length;

        const toInsert: Array<{
          roomId: string;
          memberId: null;
          displayName: string;
          code: string;
          isSimulated: boolean;
        }> = [];

        for (let i = 0; i < requestedCount; i += 1) {
          const code = allocateUniqueCode(usedCodeStrings);
          toInsert.push({
            roomId,
            memberId: null,
            displayName: `Simulado ${existingSimCount + i + 1}`,
            code,
            isSimulated: true,
          });
        }

        const inserted = await tx.insert(roomMemberCodes).values(toInsert).returning();
        return inserted.map(toStoredAccessCode);
      });
    },

    async listAccessCodes(roomId) {
      const rows = await db
        .select()
        .from(roomMemberCodes)
        .where(and(eq(roomMemberCodes.roomId, roomId), eq(roomMemberCodes.isSimulated, false)))
        .orderBy(asc(roomMemberCodes.displayName), desc(roomMemberCodes.createdAt));
      return rows.map(toStoredAccessCode);
    },

    async revokeAccessCode(roomId, codeId) {
      return db.transaction(async (tx) => {
        const now = new Date();
        const updated = await tx
          .update(roomMemberCodes)
          .set({ revokedAt: now })
          .where(
            and(
              eq(roomMemberCodes.id, codeId),
              eq(roomMemberCodes.roomId, roomId),
              isNull(roomMemberCodes.revokedAt),
            ),
          )
          .returning();
        const row = updated[0];
        if (!row) {
          return null;
        }
        await tx
          .update(participants)
          .set({ isPresent: false })
          .where(and(eq(participants.roomId, roomId), eq(participants.accessCodeId, row.id)));
        return toStoredAccessCode(row);
      });
    },

    async revokeAllAccessCodes(roomId) {
      return db.transaction(async (tx) => {
        const now = new Date();
        const updated = await tx
          .update(roomMemberCodes)
          .set({ revokedAt: now })
          .where(and(eq(roomMemberCodes.roomId, roomId), isNull(roomMemberCodes.revokedAt)))
          .returning({ id: roomMemberCodes.id });
        if (updated.length > 0) {
          await tx
            .update(participants)
            .set({ isPresent: false })
            .where(eq(participants.roomId, roomId));
        }
        return updated.length;
      });
    },

    async deleteAccessCode(roomId, codeId) {
      return db.transaction(async (tx) => {
        await tx
          .update(participants)
          .set({ accessCodeId: null, isPresent: false })
          .where(and(eq(participants.roomId, roomId), eq(participants.accessCodeId, codeId)));
        const deleted = await tx
          .delete(roomMemberCodes)
          .where(and(eq(roomMemberCodes.id, codeId), eq(roomMemberCodes.roomId, roomId)))
          .returning({ id: roomMemberCodes.id });
        return deleted.length > 0;
      });
    },

    async issueMemberAccessCode(roomId, memberId, replace) {
      return db.transaction(async (tx) => {
        const roomRows = await tx
          .select()
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1)
          .for("update");
        const room = roomRows[0];
        if (!room) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        const rosterRows = await tx
          .select()
          .from(roomRoster)
          .where(
            and(
              eq(roomRoster.roomId, roomId),
              eq(roomRoster.memberId, memberId),
              isNull(roomRoster.removedAt),
            ),
          )
          .limit(1);
        const rosterEntry = rosterRows[0];

        let rosterEntryId: string;
        let displayName: string;
        if (rosterEntry) {
          if (!rosterEntry.isEligibleVoter || rosterEntry.votesOnPaper) {
            return { ok: false as const, reason: "member_ineligible" as const };
          }
          rosterEntryId = rosterEntry.id;
          displayName = rosterEntry.fullName;
        } else {
          const memberRows = await tx
            .select()
            .from(members)
            .where(
              and(
                eq(members.id, memberId),
                eq(members.churchId, room.churchId),
                isNull(members.deletedAt),
              ),
            )
            .limit(1);
          const member = memberRows[0];
          if (!member) {
            return { ok: false as const, reason: "member_not_found" as const };
          }
          if (
            !isMemberEligibleVoter(
              {
                isCommunicant: member.isCommunicant,
                societyFlags: (member.societyFlags ?? {}) as MemberSocietyFlags,
              },
              room.roomType as RoomType,
            )
          ) {
            return { ok: false as const, reason: "member_ineligible" as const };
          }
          const insertedRoster = await tx
            .insert(roomRoster)
            .values({
              roomId,
              memberId: member.id,
              fullName: member.fullName,
              photoUrl: member.photoUrl,
              birthDate: member.birthDate,
              isCommunicant: member.isCommunicant,
              isMale: member.isMale,
              societyFlags: member.societyFlags ?? {},
              isEligibleVoter: true,
            })
            .returning({ id: roomRoster.id });
          rosterEntryId = insertedRoster[0]!.id;
          displayName = member.fullName;
          await recalculateRoomEligibleCount(tx, roomId);
        }

        const activeRows = await tx
          .select()
          .from(roomMemberCodes)
          .where(
            and(
              eq(roomMemberCodes.roomId, roomId),
              eq(roomMemberCodes.memberId, memberId),
              isNull(roomMemberCodes.revokedAt),
            ),
          )
          .limit(1)
          .for("update");
        const active = activeRows[0];
        if (active && !replace) {
          return { ok: true as const, accessCode: toStoredAccessCode(active), created: false };
        }
        if (active) {
          const now = new Date();
          await tx
            .update(roomMemberCodes)
            .set({ revokedAt: now })
            .where(eq(roomMemberCodes.id, active.id));
          await tx
            .update(participants)
            .set({ isPresent: false })
            .where(and(eq(participants.roomId, roomId), eq(participants.accessCodeId, active.id)));
        }

        const usedRows = await tx
          .select({ code: roomMemberCodes.code })
          .from(roomMemberCodes)
          .where(eq(roomMemberCodes.roomId, roomId));
        const code = allocateUniqueCode(new Set(usedRows.map((row) => row.code)));
        const inserted = await tx
          .insert(roomMemberCodes)
          .values({
            roomId,
            rosterEntryId,
            memberId,
            displayName,
            code,
            isSimulated: false,
          })
          .returning();
        const row = inserted[0];
        if (!row) {
          throw new Error("Access code insert returned no row");
        }
        return { ok: true as const, accessCode: toStoredAccessCode(row), created: true };
      });
    },

    async removePresentParticipants(roomId, limit) {
      if (limit <= 0) {
        return 0;
      }
      const rows = await db
        .select({ id: participants.id })
        .from(participants)
        .where(and(eq(participants.roomId, roomId), eq(participants.isPresent, true)))
        .orderBy(desc(participants.joinedAt), desc(participants.id))
        .limit(limit);
      const ids = rows.map((row) => row.id);
      if (ids.length === 0) {
        return 0;
      }
      const updated = await db
        .update(participants)
        .set({ isPresent: false })
        .where(and(eq(participants.roomId, roomId), inArray(participants.id, ids)))
        .returning({ id: participants.id });
      return updated.length;
    },

    async expelParticipants(roomId, participantId) {
      const presentOnly = and(eq(participants.roomId, roomId), eq(participants.isPresent, true));
      const updated = await db
        .update(participants)
        .set({ isPresent: false })
        .where(participantId ? and(presentOnly, eq(participants.id, participantId)) : presentOnly)
        .returning({ id: participants.id });
      if (updated.length > 0) {
        const roomRows = await db
          .select({ churchId: rooms.churchId, title: rooms.title })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1);
        const room = roomRows[0];
        await insertAuditEvent(
          db,
          roomId,
          "participant_expelled",
          {
            expelledCount: updated.length,
            allPresent: participantId === undefined,
          },
          {
            churchId: room?.churchId ?? null,
            roomTitle: room?.title ?? null,
            actorRole: "admin",
          },
        );
      }
      return updated.length;
    },

    async releaseParticipantSession(roomId, participantId, actorAdminId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const roomRows = await tx
          .select({ id: rooms.id, title: rooms.title, churchId: rooms.churchId })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .limit(1);
        const roomRow = roomRows[0];
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        const participantRows = await tx
          .select({
            id: participants.id,
            displayName: participants.displayName,
          })
          .from(participants)
          .where(and(eq(participants.id, participantId), eq(participants.roomId, roomId)))
          .for("update")
          .limit(1);
        const participant = participantRows[0];
        if (!participant) {
          return { ok: false as const, reason: "participant_not_found" as const };
        }

        const updatedRows = await tx
          .update(participants)
          .set({ joinKeyHash: null, isPresent: false })
          .where(and(eq(participants.id, participantId), eq(participants.roomId, roomId)))
          .returning({
            id: participants.id,
            displayName: participants.displayName,
            isPresent: participants.isPresent,
          });
        const updated = updatedRows[0];
        if (!updated) {
          return { ok: false as const, reason: "participant_not_found" as const };
        }

        await insertAuditEvent(
          tx,
          roomId,
          "session_released",
          {
            participantId: updated.id,
            displayName: updated.displayName,
            actorAdminId,
          },
          {
            churchId: roomRow.churchId,
            roomTitle: roomRow.title,
            actorRole: "admin",
          },
        );

        return { ok: true as const, participant: updated };
      });
    },

    async describeVoterSession(roomId, joinKeyHash) {
      const participant = await findParticipantByJoinKey(db, roomId, joinKeyHash);
      if (!participant) {
        return "missing";
      }
      if (participant.accessCodeId) {
        const codeRows = await db
          .select({ revokedAt: roomMemberCodes.revokedAt })
          .from(roomMemberCodes)
          .where(eq(roomMemberCodes.id, participant.accessCodeId))
          .limit(1);
        if (!codeRows[0] || codeRows[0].revokedAt !== null) {
          return "revoked";
        }
      }
      return participant.isPresent ? "present" : "absent";
    },

    async countPresent(roomId) {
      const rows = await db
        .select({ value: count() })
        .from(participants)
        .where(and(eq(participants.roomId, roomId), eq(participants.isPresent, true)));
      const presentCount = Number(rows[0]?.value ?? 0);
      if (!Number.isInteger(presentCount)) {
        throw new Error("Presence count was not an integer");
      }
      return presentCount;
    },

    async countPaperVoters(roomId) {
      const rows = await db
        .select({ value: count() })
        .from(roomRoster)
        .where(
          and(
            eq(roomRoster.roomId, roomId),
            isNull(roomRoster.removedAt),
            eq(roomRoster.votesOnPaper, true),
          ),
        );
      const paperVotersCount = Number(rows[0]?.value ?? 0);
      if (!Number.isInteger(paperVotersCount)) {
        throw new Error("Paper voters count was not an integer");
      }
      return paperVotersCount;
    },

    async listCandidates(roomId) {
      const rows = await db
        .select({
          id: candidates.id,
          roomId: candidates.roomId,
          memberId: candidates.memberId,
          displayName: candidates.displayName,
          photoUrl: candidates.photoUrl,
          birthDate: candidates.birthDate,
          isEligible: candidates.isEligible,
        })
        .from(candidates)
        .where(and(eq(candidates.roomId, roomId), eq(candidates.isEligible, true)))
        .orderBy(asc(candidates.displayName));
      return rows.map(toStoredCandidate);
    },

    async listAllCandidates(roomId) {
      const rows = await db
        .select({
          id: candidates.id,
          roomId: candidates.roomId,
          memberId: candidates.memberId,
          displayName: candidates.displayName,
          photoUrl: candidates.photoUrl,
          birthDate: candidates.birthDate,
          isEligible: candidates.isEligible,
        })
        .from(candidates)
        .where(eq(candidates.roomId, roomId))
        .orderBy(asc(candidates.displayName));
      return rows.map(toStoredCandidate);
    },

    async listCandidatesByRooms(roomIds) {
      if (roomIds.length === 0) {
        return [];
      }

      const rows = await db
        .select({
          id: candidates.id,
          roomId: candidates.roomId,
          memberId: candidates.memberId,
          displayName: candidates.displayName,
          photoUrl: candidates.photoUrl,
          birthDate: candidates.birthDate,
          isEligible: candidates.isEligible,
        })
        .from(candidates)
        .where(and(inArray(candidates.roomId, roomIds), eq(candidates.isEligible, true)))
        .orderBy(asc(candidates.displayName));
      return rows.map(toStoredCandidate);
    },

    async listRoomRoster(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }
      const [roomRow] = await db
        .select({ id: rooms.id, eligibleCount: rooms.eligibleCount })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
        .limit(1);
      if (!roomRow) {
        return null;
      }

      const [rosterRows, codeRows, presentRows] = await Promise.all([
        db
          .select()
          .from(roomRoster)
          .where(and(eq(roomRoster.roomId, roomId), isNull(roomRoster.removedAt)))
          .orderBy(asc(roomRoster.fullName), asc(roomRoster.createdAt)),
        db
          .select()
          .from(roomMemberCodes)
          .where(and(eq(roomMemberCodes.roomId, roomId), eq(roomMemberCodes.isSimulated, false)))
          .orderBy(desc(roomMemberCodes.createdAt)),
        db
          .select({
            id: participants.id,
            rosterEntryId: participants.rosterEntryId,
            accessCodeId: participants.accessCodeId,
            memberId: participants.memberId,
          })
          .from(participants)
          .where(and(eq(participants.roomId, roomId), eq(participants.isPresent, true))),
      ]);

      const entries: StoredRosterEntry[] = rosterRows.map((entry) => {
        const matchingCodes = codeRows.filter(
          (code) =>
            code.rosterEntryId === entry.id ||
            (code.rosterEntryId === null && entry.memberId !== null && code.memberId === entry.memberId),
        );
        const preferredCode =
          matchingCodes.find((code) => code.revokedAt === null) ?? matchingCodes[0] ?? null;

        const isPresent = presentRows.some(
          (participant) =>
            participant.rosterEntryId === entry.id ||
            (preferredCode !== null && participant.accessCodeId === preferredCode.id) ||
            (entry.memberId !== null && participant.memberId === entry.memberId),
        );

        return toStoredRosterEntry(entry, preferredCode, isPresent);
      });

      return {
        entries,
        eligibleCount: roomRow.eligibleCount,
      };
    },

    async addRosterEntry(roomId, input) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [roomRow] = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }
        if (roomRow.status === "closed") {
          return { ok: false as const, reason: "room_closed" as const };
        }

        let memberId: string | null = null;
        let fullName: string;
        let photoUrl: string | null = null;
        let birthDate: Date | null = null;
        let isCommunicant = true;
        let isMale: boolean | null = null;
        let societyFlags: Record<string, unknown> = {};
        let isEligibleVoter = true;

        if ("memberId" in input) {
          const [member] = await tx
            .select()
            .from(members)
            .where(
              and(
                eq(members.id, input.memberId),
                eq(members.churchId, church.id),
                isNull(members.deletedAt),
              ),
            )
            .limit(1);
          if (!member) {
            return { ok: false as const, reason: "member_not_found" as const };
          }

          const [existingActive] = await tx
            .select({ id: roomRoster.id })
            .from(roomRoster)
            .where(
              and(
                eq(roomRoster.roomId, roomId),
                eq(roomRoster.memberId, member.id),
                isNull(roomRoster.removedAt),
              ),
            )
            .limit(1);
          if (existingActive) {
            return { ok: false as const, reason: "roster_member_exists" as const };
          }

          memberId = member.id;
          fullName = member.fullName;
          photoUrl = member.photoUrl;
          birthDate = member.birthDate;
          isCommunicant = member.isCommunicant;
          isMale = member.isMale;
          societyFlags = member.societyFlags ?? {};
          isEligibleVoter = member.isCommunicant;
        } else {
          fullName = input.fullName.trim();
          birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
          isCommunicant = input.isCommunicant ?? true;
          isMale = input.isMale ?? null;
          isEligibleVoter = isCommunicant;
        }

        const [insertedEntry] = await tx
          .insert(roomRoster)
          .values({
            roomId,
            memberId,
            fullName,
            photoUrl,
            birthDate,
            isCommunicant,
            isMale,
            societyFlags,
            isEligibleVoter,
          })
          .returning();
        if (!insertedEntry) {
          throw new Error("Roster entry insert returned no row");
        }

        if (memberId !== null) {
          await tx
            .update(roomMemberCodes)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(roomMemberCodes.roomId, roomId),
                eq(roomMemberCodes.memberId, memberId),
                isNull(roomMemberCodes.revokedAt),
              ),
            );
        }

        const existingCodes = await tx
          .select({ code: roomMemberCodes.code })
          .from(roomMemberCodes)
          .where(eq(roomMemberCodes.roomId, roomId));
        const code = allocateUniqueCode(new Set(existingCodes.map((row) => row.code)));

        const [insertedCode] = await tx
          .insert(roomMemberCodes)
          .values({
            roomId,
            rosterEntryId: insertedEntry.id,
            memberId,
            displayName: fullName,
            code,
            isSimulated: false,
          })
          .returning();
        if (!insertedCode) {
          throw new Error("Access code insert returned no row");
        }

        const eligibleCount = await recalculateRoomEligibleCount(tx, roomId);

        await insertAuditEvent(
          tx,
          roomId,
          "roster_member_added",
          {
            rosterEntryId: insertedEntry.id,
            memberId: insertedEntry.memberId,
            fullName: insertedEntry.fullName,
            isAdHoc: insertedEntry.memberId === null,
          },
          {
            churchId: church.id,
            roomTitle: roomRow.title,
            actorRole: "admin",
          },
        );

        return {
          ok: true as const,
          entry: toStoredRosterEntry(insertedEntry, insertedCode, false),
          accessCode: toStoredAccessCode(insertedCode),
          eligibleCount,
        };
      });
    },

    async removeRosterEntry(roomId, entryId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [roomRow] = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }
        if (roomRow.status === "closed") {
          return { ok: false as const, reason: "room_closed" as const };
        }

        const [entry] = await tx
          .select()
          .from(roomRoster)
          .where(
            and(
              eq(roomRoster.id, entryId),
              eq(roomRoster.roomId, roomId),
              isNull(roomRoster.removedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!entry) {
          return { ok: false as const, reason: "roster_entry_not_found" as const };
        }

        const now = new Date();
        await tx
          .update(roomRoster)
          .set({ removedAt: now })
          .where(eq(roomRoster.id, entry.id));

        const codeFilter =
          entry.memberId !== null
            ? or(
                eq(roomMemberCodes.rosterEntryId, entry.id),
                eq(roomMemberCodes.memberId, entry.memberId),
              )
            : eq(roomMemberCodes.rosterEntryId, entry.id);

        const revokedCodes = await tx
          .update(roomMemberCodes)
          .set({ revokedAt: now })
          .where(
            and(
              eq(roomMemberCodes.roomId, roomId),
              isNull(roomMemberCodes.revokedAt),
              codeFilter,
            ),
          )
          .returning({ id: roomMemberCodes.id });

        const revokedCodeIds = revokedCodes.map((row) => row.id);
        const participantMatchers = [eq(participants.rosterEntryId, entry.id)];
        if (entry.memberId !== null) {
          participantMatchers.push(eq(participants.memberId, entry.memberId));
        }
        if (revokedCodeIds.length > 0) {
          participantMatchers.push(inArray(participants.accessCodeId, revokedCodeIds));
        }

        await tx
          .update(participants)
          .set({ isPresent: false, joinKeyHash: null })
          .where(and(eq(participants.roomId, roomId), or(...participantMatchers)));

        const eligibleCount = await recalculateRoomEligibleCount(tx, roomId);

        await insertAuditEvent(
          tx,
          roomId,
          "roster_member_removed",
          {
            rosterEntryId: entry.id,
            memberId: entry.memberId,
            fullName: entry.fullName,
          },
          {
            churchId: church.id,
            roomTitle: roomRow.title,
            actorRole: "admin",
          },
        );

        return { ok: true as const, eligibleCount };
      });
    },

    async setRosterEntryPaperMode(roomId, entryId, votesOnPaper) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [roomRow] = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }
        if (roomRow.status === "closed") {
          return { ok: false as const, reason: "room_closed" as const };
        }

        const [entry] = await tx
          .select()
          .from(roomRoster)
          .where(
            and(
              eq(roomRoster.id, entryId),
              eq(roomRoster.roomId, roomId),
              isNull(roomRoster.removedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (!entry) {
          return { ok: false as const, reason: "roster_entry_not_found" as const };
        }

        const [openRound] = await tx
          .select({ id: rounds.id })
          .from(rounds)
          .where(and(eq(rounds.roomId, roomId), eq(rounds.status, "open")))
          .orderBy(desc(rounds.number))
          .limit(1);

        if (openRound) {
          if (votesOnPaper) {
            const voterParticipantMatchers = [eq(participants.rosterEntryId, entry.id)];
            if (entry.memberId !== null) {
              voterParticipantMatchers.push(eq(participants.memberId, entry.memberId));
            }
            const matchingParticipants = await tx
              .select({ id: participants.id })
              .from(participants)
              .where(and(eq(participants.roomId, roomId), or(...voterParticipantMatchers)));
            if (matchingParticipants.length > 0) {
              const existingReceipt = await tx
                .select({ id: voteReceipts.id })
                .from(voteReceipts)
                .where(
                  and(
                    eq(voteReceipts.roundId, openRound.id),
                    inArray(
                      voteReceipts.participantId,
                      matchingParticipants.map((p) => p.id),
                    ),
                  ),
                )
                .limit(1);
              if (existingReceipt.length > 0) {
                return { ok: false as const, reason: "already_voted_online" as const };
              }
            }
          } else if (entry.votesOnPaper) {
            const [existingPaperTally] = await tx
              .select({ ballotCount: roundPaperTallies.ballotCount })
              .from(roundPaperTallies)
              .where(eq(roundPaperTallies.roundId, openRound.id))
              .limit(1);
            if (existingPaperTally && existingPaperTally.ballotCount > 0) {
              return { ok: false as const, reason: "paper_tally_already_recorded" as const };
            }
          }
        }

        const [updatedEntry] = await tx
          .update(roomRoster)
          .set({ votesOnPaper })
          .where(eq(roomRoster.id, entry.id))
          .returning();
        const savedEntry = updatedEntry ?? { ...entry, votesOnPaper };

        const now = new Date();
        const codeFilter =
          entry.memberId !== null
            ? or(
                eq(roomMemberCodes.rosterEntryId, entry.id),
                eq(roomMemberCodes.memberId, entry.memberId),
              )
            : eq(roomMemberCodes.rosterEntryId, entry.id);

        let returnedCode: typeof roomMemberCodes.$inferSelect | null = null;
        let entryAccessCode: { id: string; code: string; revokedAt: Date | null } | null = null;
        let entryIsPresent = false;

        if (votesOnPaper) {
          const revokedCodes = await tx
            .update(roomMemberCodes)
            .set({ revokedAt: now })
            .where(
              and(
                eq(roomMemberCodes.roomId, roomId),
                isNull(roomMemberCodes.revokedAt),
                codeFilter,
              ),
            )
            .returning();

          const revokedCodeIds = revokedCodes.map((row) => row.id);
          const participantMatchers = [eq(participants.rosterEntryId, entry.id)];
          if (entry.memberId !== null) {
            participantMatchers.push(eq(participants.memberId, entry.memberId));
          }
          if (revokedCodeIds.length > 0) {
            participantMatchers.push(inArray(participants.accessCodeId, revokedCodeIds));
          }

          await tx
            .update(participants)
            .set({ isPresent: false, joinKeyHash: null })
            .where(and(eq(participants.roomId, roomId), or(...participantMatchers)));

          const latestCodes = await tx
            .select({
              id: roomMemberCodes.id,
              code: roomMemberCodes.code,
              revokedAt: roomMemberCodes.revokedAt,
            })
            .from(roomMemberCodes)
            .where(and(eq(roomMemberCodes.roomId, roomId), codeFilter))
            .orderBy(desc(roomMemberCodes.createdAt))
            .limit(1);
          entryAccessCode = latestCodes[0] ?? null;

          await insertAuditEvent(
            tx,
            roomId,
            "roster_paper_mode_enabled",
            {
              rosterEntryId: entry.id,
              memberId: entry.memberId,
              fullName: entry.fullName,
            },
            {
              churchId: church.id,
              roomTitle: roomRow.title,
              actorRole: "admin",
            },
          );
        } else {
          await tx
            .update(roomMemberCodes)
            .set({ revokedAt: now })
            .where(
              and(
                eq(roomMemberCodes.roomId, roomId),
                isNull(roomMemberCodes.revokedAt),
                codeFilter,
              ),
            );

          const existingCodes = await tx
            .select({ code: roomMemberCodes.code })
            .from(roomMemberCodes)
            .where(eq(roomMemberCodes.roomId, roomId));
          const code = allocateUniqueCode(new Set(existingCodes.map((row) => row.code)));

          const [insertedCode] = await tx
            .insert(roomMemberCodes)
            .values({
              roomId,
              rosterEntryId: entry.id,
              memberId: entry.memberId,
              displayName: entry.fullName,
              code,
              isSimulated: false,
            })
            .returning();
          if (!insertedCode) {
            throw new Error("Access code insert returned no row");
          }
          returnedCode = insertedCode;
          entryAccessCode = insertedCode;

          const presentMatchers = [eq(participants.rosterEntryId, entry.id)];
          if (entry.memberId !== null) {
            presentMatchers.push(eq(participants.memberId, entry.memberId));
          }
          const presentParticipant = await tx
            .select({ id: participants.id })
            .from(participants)
            .where(
              and(
                eq(participants.roomId, roomId),
                eq(participants.isPresent, true),
                or(...presentMatchers),
              ),
            )
            .limit(1);
          entryIsPresent = Boolean(presentParticipant[0]);

          await insertAuditEvent(
            tx,
            roomId,
            "roster_paper_mode_disabled",
            {
              rosterEntryId: entry.id,
              memberId: entry.memberId,
              fullName: entry.fullName,
            },
            {
              churchId: church.id,
              roomTitle: roomRow.title,
              actorRole: "admin",
            },
          );
        }

        const [onlinePresentRows, paperVoterRows] = await Promise.all([
          tx
            .select({ value: count() })
            .from(participants)
            .where(and(eq(participants.roomId, roomId), eq(participants.isPresent, true))),
          tx
            .select({ value: count() })
            .from(roomRoster)
            .where(
              and(
                eq(roomRoster.roomId, roomId),
                isNull(roomRoster.removedAt),
                eq(roomRoster.votesOnPaper, true),
              ),
            ),
        ]);

        return {
          ok: true as const,
          entry: toStoredRosterEntry(savedEntry, entryAccessCode, entryIsPresent),
          accessCode: returnedCode ? toStoredAccessCode(returnedCode) : null,
          onlinePresentCount: Number(onlinePresentRows[0]?.value ?? 0),
          paperVotersCount: Number(paperVoterRows[0]?.value ?? 0),
        };
      });
    },

    async addRoomCandidate(roomId, input) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [roomRow] = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        const roomType = roomRow.roomType as RoomType;
        const normalizedOffice = input.officeLabel?.trim();
        if (normalizedOffice && isMultiOfficeRoomType(roomType)) {
          if (!isValidOfficeForRoomType(roomType, normalizedOffice)) {
            return { ok: false as const, reason: "invalid_office" as const };
          }
        }

        const roomRounds = await tx
          .select({ officeLabel: rounds.officeLabel })
          .from(rounds)
          .where(eq(rounds.roomId, roomId));
        const hasRoundsForScope =
          normalizedOffice && isMultiOfficeRoomType(roomType)
            ? roomRounds.some((row) => row.officeLabel === normalizedOffice)
            : roomRounds.length > 0;

        const guard = canManageRoomCandidates(roomRow.status as RoomStatus, hasRoundsForScope);
        if (!guard.allowed) {
          return { ok: false as const, reason: "candidates_locked_after_round" as const };
        }

        let memberId: string | null = null;
        let displayName: string;
        let photoUrl: string | null = null;
        let birthDate: Date | null = null;

        if (input.rosterEntryId) {
          const [rosterEntry] = await tx
            .select()
            .from(roomRoster)
            .where(
              and(
                eq(roomRoster.id, input.rosterEntryId),
                eq(roomRoster.roomId, roomId),
                isNull(roomRoster.removedAt),
              ),
            )
            .limit(1);
          if (!rosterEntry) {
            return { ok: false as const, reason: "roster_entry_not_found" as const };
          }
          memberId = rosterEntry.memberId;
          displayName = rosterEntry.fullName;
          photoUrl = rosterEntry.photoUrl;
          birthDate = rosterEntry.birthDate;
        } else if (input.memberId) {
          const [rosterEntry] = await tx
            .select()
            .from(roomRoster)
            .where(
              and(
                eq(roomRoster.roomId, roomId),
                eq(roomRoster.memberId, input.memberId),
                isNull(roomRoster.removedAt),
              ),
            )
            .limit(1);
          if (rosterEntry) {
            memberId = rosterEntry.memberId;
            displayName = rosterEntry.fullName;
            photoUrl = rosterEntry.photoUrl;
            birthDate = rosterEntry.birthDate;
          } else {
            const [member] = await tx
              .select()
              .from(members)
              .where(
                and(
                  eq(members.id, input.memberId),
                  eq(members.churchId, church.id),
                  isNull(members.deletedAt),
                ),
              )
              .limit(1);
            if (!member) {
              return { ok: false as const, reason: "member_not_found" as const };
            }
            memberId = member.id;
            displayName = member.fullName;
            photoUrl = member.photoUrl;
            birthDate = member.birthDate;
          }
        } else {
          const trimmed = input.displayName?.trim() ?? "";
          if (trimmed.length === 0 || trimmed.length > 120) {
            return { ok: false as const, reason: "invalid_candidate" as const };
          }
          displayName = trimmed;
          birthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
        }

        const existingCandidates = await tx
          .select()
          .from(candidates)
          .where(eq(candidates.roomId, roomId))
          .orderBy(asc(candidates.displayName));
        if (
          existingCandidates.some(
            (item) => item.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase(),
          )
        ) {
          return { ok: false as const, reason: "candidate_exists" as const };
        }

        const [inserted] = await tx
          .insert(candidates)
          .values({
            roomId,
            memberId,
            displayName,
            photoUrl,
            birthDate,
            isEligible: true,
          })
          .returning();
        if (!inserted) {
          throw new Error("Candidate insert returned no row");
        }

        await insertAuditEvent(
          tx,
          roomId,
          "candidate_added",
          {
            candidateId: inserted.id,
            displayName: inserted.displayName,
            memberId: inserted.memberId,
            ...(normalizedOffice ? { officeLabel: normalizedOffice } : {}),
          },
          {
            churchId: church.id,
            roomTitle: roomRow.title,
            actorRole: "admin",
          },
        );

        const updatedCandidates = [...existingCandidates, inserted].sort((a, b) =>
          a.displayName.localeCompare(b.displayName),
        );
        return {
          ok: true as const,
          candidate: toStoredCandidate(inserted),
          candidates: updatedCandidates.map(toStoredCandidate),
        };
      });
    },

    async removeRoomCandidate(roomId, candidateId, officeLabel) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [roomRow] = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        const [candidate] = await tx
          .select()
          .from(candidates)
          .where(and(eq(candidates.id, candidateId), eq(candidates.roomId, roomId)))
          .limit(1);
        if (!candidate) {
          return { ok: false as const, reason: "candidate_not_found" as const };
        }

        const roomType = roomRow.roomType as RoomType;
        const normalizedOffice = officeLabel?.trim();
        if (normalizedOffice && isMultiOfficeRoomType(roomType)) {
          if (!isValidOfficeForRoomType(roomType, normalizedOffice)) {
            return { ok: false as const, reason: "invalid_office" as const };
          }
        }

        const roomRounds = await tx
          .select({ officeLabel: rounds.officeLabel })
          .from(rounds)
          .where(eq(rounds.roomId, roomId));
        const hasRoundsForScope =
          normalizedOffice && isMultiOfficeRoomType(roomType)
            ? roomRounds.some((row) => row.officeLabel === normalizedOffice)
            : roomRounds.length > 0;

        const guard = canManageRoomCandidates(roomRow.status as RoomStatus, hasRoundsForScope);
        if (!guard.allowed) {
          return { ok: false as const, reason: "candidates_locked_after_round" as const };
        }

        const ballotRefs = await tx
          .select({ id: ballots.id })
          .from(ballots)
          .where(eq(ballots.candidateId, candidateId))
          .limit(1);
        if (ballotRefs.length > 0) {
          return { ok: false as const, reason: "candidates_locked_after_round" as const };
        }

        await tx
          .delete(candidates)
          .where(and(eq(candidates.id, candidateId), eq(candidates.roomId, roomId)));

        await insertAuditEvent(
          tx,
          roomId,
          "candidate_removed",
          {
            candidateId: candidate.id,
            displayName: candidate.displayName,
            memberId: candidate.memberId,
            ...(normalizedOffice ? { officeLabel: normalizedOffice } : {}),
          },
          {
            churchId: church.id,
            roomTitle: roomRow.title,
            actorRole: "admin",
          },
        );

        const remaining = await tx
          .select()
          .from(candidates)
          .where(eq(candidates.roomId, roomId))
          .orderBy(asc(candidates.displayName));
        return {
          ok: true as const,
          candidates: remaining.map(toStoredCandidate),
        };
      });
    },

    async openRound(roomId, eligibleCandidateIds, officeLabel) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const existing = await db.select().from(rounds).where(eq(rounds.roomId, roomId));
        if (existing.some((row) => row.status === "open")) {
          return { ok: false, reason: "round_already_open" };
        }

        const number = existing.reduce((max, row) => Math.max(max, row.number), 0) + 1;
        try {
          return await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(rounds)
              .values({
                roomId,
                number,
                officeLabel: officeLabel ?? null,
                status: "open",
                openedAt: new Date(),
              })
              .returning();
            const row = inserted[0];
            if (!row) {
              throw new Error("Round insert returned no row");
            }

            if (eligibleCandidateIds !== undefined) {
              const roomCandidates = await tx
                .select({ id: candidates.id })
                .from(candidates)
                .where(eq(candidates.roomId, roomId));
              const allowed = new Set(eligibleCandidateIds);
              const restoredIds = roomCandidates
                .map((candidate) => candidate.id)
                .filter((id) => allowed.has(id));
              const eliminatedIds = roomCandidates
                .map((candidate) => candidate.id)
                .filter((id) => !allowed.has(id));
              if (restoredIds.length > 0) {
                await tx
                  .update(candidates)
                  .set({ isEligible: true })
                  .where(and(eq(candidates.roomId, roomId), inArray(candidates.id, restoredIds)));
              }
              if (eliminatedIds.length > 0) {
                await tx
                  .update(candidates)
                  .set({ isEligible: false })
                  .where(and(eq(candidates.roomId, roomId), inArray(candidates.id, eliminatedIds)));
              }
            }

        const roomRows = await tx
          .select({ churchId: rooms.churchId, title: rooms.title })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1);
        const roomMeta = roomRows[0];

        await insertAuditEvent(
          tx,
          roomId,
          "round_opened",
          {
            roundId: row.id,
            roundNumber: row.number,
            ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
          },
          {
            churchId: roomMeta?.churchId ?? null,
            roomTitle: roomMeta?.title ?? null,
            actorRole: "admin",
          },
        );

            return { ok: true as const, round: toStoredRound(row) };
          });
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
        }
      }

      return { ok: false, reason: "round_already_open" };
    },

    async closeRound(roomId, roundId, outcome, closeOptions) {
      return db.transaction(async (tx) => {
        const lockedRows = await tx
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId)))
          .for("update")
          .limit(1);
        const lockedRound = lockedRows[0];
        if (!lockedRound || lockedRound.status !== "open") {
          return null;
        }

        const updated = await tx
          .update(rounds)
          .set({
            status: "closed",
            outcome,
            winnerCandidateId: closeOptions?.winnerCandidateId ?? null,
            tieBreakReason: closeOptions?.tieBreakReason ?? null,
            didNotVoteCount: closeOptions?.didNotVoteCount ?? null,
            closedAt: new Date(),
          })
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId), eq(rounds.status, "open")))
          .returning();
        const row = updated[0];
        if (!row) {
          return null;
        }

        const roomRows = await tx
          .select({ churchId: rooms.churchId, title: rooms.title })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1);
        const roomMeta = roomRows[0];

        await insertAuditEvent(
          tx,
          roomId,
          "round_closed",
          {
            roundId: row.id,
            roundNumber: row.number,
            outcome: row.outcome,
            ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
            ...(row.tieBreakReason ? { tieBreakReason: row.tieBreakReason } : {}),
            ...(row.winnerCandidateId ? { winnerCandidateId: row.winnerCandidateId } : {}),
            ...(closeOptions?.didNotVoteCount !== undefined
              ? { didNotVoteCount: closeOptions.didNotVoteCount }
              : {}),
          },
          {
            churchId: roomMeta?.churchId ?? null,
            roomTitle: roomMeta?.title ?? null,
            actorRole: "admin",
          },
        );

        const restartCounts = await loadRestartCountsByRoom(tx, [roomId]);
        return toStoredRound(row, restartCounts.get(row.id) ?? 0);
      });
    },

    async closeAndTallyRound(roomId, roundId, closeOptions) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {

        const roomRows = await tx
          .select()
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .limit(1);
        const roomRow = roomRows[0];
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        const roundRows = await tx
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId)))
          .for("update")
          .limit(1);
        const roundRow = roundRows[0];
        if (!roundRow) {
          return { ok: false as const, reason: "round_not_found" as const };
        }
        if (roundRow.status !== "open") {
          return { ok: false as const, reason: "round_not_open" as const };
        }

        const [onlinePresentRows, paperVoterRows] = await Promise.all([
          tx
            .select({ value: count() })
            .from(participants)
            .where(and(eq(participants.roomId, roomId), eq(participants.isPresent, true))),
          tx
            .select({ value: count() })
            .from(roomRoster)
            .where(
              and(
                eq(roomRoster.roomId, roomId),
                isNull(roomRoster.removedAt),
                eq(roomRoster.votesOnPaper, true),
              ),
            ),
        ]);
        const onlinePresentCount = Number(onlinePresentRows[0]?.value ?? 0);
        const paperVotersCount = Number(paperVoterRows[0]?.value ?? 0);

        const quorum = quorumStatus(toStoredRoom(roomRow), onlinePresentCount, paperVotersCount);

        const allRoundRows = await tx
          .select()
          .from(rounds)
          .where(eq(rounds.roomId, roomId))
          .orderBy(asc(rounds.number));
        const allStoredRounds = allRoundRows.map((item) => toStoredRound(item));
        const currentStoredRound = toStoredRound(roundRow);
        const officeRoundNumber = countOfficeRoundNumber(allStoredRounds, currentStoredRound);

        let tally: RoundTally | null = null;
        let outcome: RoundResult | null = closeRoundOutcome(quorum.quorumMet);
        let didNotVoteCount = 0;

        if (quorum.quorumMet) {
          const ballotRows = await tx
            .select({ candidateId: ballots.candidateId })
            .from(ballots)
            .where(eq(ballots.roundId, roundId))
            .orderBy(asc(ballots.candidateId));
          const ballotCandidateIds = ballotRows.map((item) => item.candidateId);
          const onlineVotedCount = ballotCandidateIds.length;

          if (onlineVotedCount < onlinePresentCount && !closeOptions?.confirmPending) {
            return {
              ok: false as const,
              reason: "voting_incomplete" as const,
              votedCount: onlineVotedCount,
              presentCount: onlinePresentCount,
            };
          }

          const [paperTallyRow] = await tx
            .select()
            .from(roundPaperTallies)
            .where(eq(roundPaperTallies.roundId, roundId))
            .limit(1);

          if (paperVotersCount > 0 && !paperTallyRow && !closeOptions?.confirmNoPaperBallots) {
            return {
              ok: false as const,
              reason: "paper_tally_required" as const,
              paperVotersCount,
            };
          }

          didNotVoteCount =
            Math.max(0, onlinePresentCount - onlineVotedCount) +
            Math.max(0, paperVotersCount - (paperTallyRow?.ballotCount ?? 0));

          const candidateRows = await tx
            .select({
              id: candidates.id,
              roomId: candidates.roomId,
              memberId: candidates.memberId,
              displayName: candidates.displayName,
              photoUrl: candidates.photoUrl,
              birthDate: candidates.birthDate,
              isEligible: candidates.isEligible,
            })
            .from(candidates)
            .where(and(eq(candidates.roomId, roomId), eq(candidates.isEligible, true)))
            .orderBy(asc(candidates.displayName));
          const eligibleCandidates = candidateRows.map(toStoredCandidate);

          if (eligibleCandidates.length > 0) {
            tally = tallyRoundVotes(eligibleCandidates, ballotCandidateIds, {
              roundNumber: officeRoundNumber,
              ...(didNotVoteCount > 0 ? { didNotVoteCount } : {}),
              ...(paperTallyRow
                ? {
                    paperTally: {
                      ballotCount: paperTallyRow.ballotCount,
                      blankVotes: paperTallyRow.blankVotes,
                      nullVotes: paperTallyRow.nullVotes,
                      candidateVotes: paperTallyRow.candidateVotes,
                    },
                  }
                : {}),
            });
            outcome = tally.outcome;
          }
        }

        const updated = await tx
          .update(rounds)
          .set({
            status: "closed",
            outcome,
            winnerCandidateId: tally?.winnerId ?? null,
            tieBreakReason: tally?.tieBreakReason ?? null,
            didNotVoteCount: quorum.quorumMet ? didNotVoteCount : null,
            closedAt: new Date(),
          })
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId), eq(rounds.status, "open")))
          .returning();
        const closedRow = updated[0];
        if (!closedRow) {
          return { ok: false as const, reason: "round_not_open" as const };
        }

        await insertAuditEvent(
          tx,
          roomId,
          "round_closed",
          {
            roundId: closedRow.id,
            roundNumber: closedRow.number,
            outcome: closedRow.outcome,
            didNotVoteCount,
            ...(closedRow.officeLabel !== null ? { officeLabel: closedRow.officeLabel } : {}),
            ...(closedRow.tieBreakReason ? { tieBreakReason: closedRow.tieBreakReason } : {}),
            ...(closedRow.winnerCandidateId
              ? { winnerCandidateId: closedRow.winnerCandidateId }
              : {}),
          },
          {
            churchId: roomRow.churchId,
            roomTitle: roomRow.title,
            actorRole: "admin",
          },
        );

        const restartCounts = await loadRestartCountsByRoom(tx, [roomId]);
        return {
          ok: true as const,
          round: toStoredRound(closedRow, restartCounts.get(closedRow.id) ?? 0),
          tally,
          quorum,
          officeRoundNumber,
          didNotVoteCount,
        };
      });
    },

    async upsertRoundPaperTally({ roomId, roundId, paperTally, adminId, adminName }) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [roomRow] = await tx
          .select({ id: rooms.id, title: rooms.title, churchId: rooms.churchId })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .limit(1);
        if (!roomRow) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        const [roundRow] = await tx
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId)))
          .for("update")
          .limit(1);
        if (!roundRow) {
          return { ok: false as const, reason: "round_not_found" as const };
        }
        if (roundRow.status !== "open") {
          return { ok: false as const, reason: "round_not_open" as const };
        }

        const [paperVoterRows, eligibleCandidateRows] = await Promise.all([
          tx
            .select({ value: count() })
            .from(roomRoster)
            .where(
              and(
                eq(roomRoster.roomId, roomId),
                isNull(roomRoster.removedAt),
                eq(roomRoster.votesOnPaper, true),
              ),
            ),
          tx
            .select({ id: candidates.id })
            .from(candidates)
            .where(and(eq(candidates.roomId, roomId), eq(candidates.isEligible, true))),
        ]);

        const paperVotersCount = Number(paperVoterRows[0]?.value ?? 0);
        const validation = validatePaperTally(paperTally, {
          paperVotersCount,
          validCandidateIds: eligibleCandidateRows.map((item) => item.id),
        });
        if (!validation.valid) {
          return {
            ok: false as const,
            reason: "validation_failed" as const,
            code: validation.code,
            message: validation.message,
          };
        }

        const now = new Date();
        const [saved] = await tx
          .insert(roundPaperTallies)
          .values({
            roundId,
            ballotCount: paperTally.ballotCount,
            blankVotes: paperTally.blankVotes,
            nullVotes: paperTally.nullVotes,
            candidateVotes: paperTally.candidateVotes,
            recordedByAdminId: adminId,
            recordedByName: adminName,
            recordedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: roundPaperTallies.roundId,
            set: {
              ballotCount: paperTally.ballotCount,
              blankVotes: paperTally.blankVotes,
              nullVotes: paperTally.nullVotes,
              candidateVotes: paperTally.candidateVotes,
              recordedByAdminId: adminId,
              recordedByName: adminName,
              updatedAt: now,
            },
          })
          .returning();
        if (!saved) {
          throw new Error("Paper tally upsert returned no row");
        }

        await insertAuditEvent(
          tx,
          roomId,
          "paper_tally_recorded",
          {
            roundId: roundRow.id,
            roundNumber: roundRow.number,
            ballotCount: saved.ballotCount,
            blankVotes: saved.blankVotes,
            nullVotes: saved.nullVotes,
            candidateVotes: saved.candidateVotes,
            recordedByName: adminName,
          },
          {
            churchId: roomRow.churchId,
            roomTitle: roomRow.title,
            actorRole: "admin",
          },
        );

        return { ok: true as const, paperTally: toStoredPaperTally(saved) };
      });
    },

    async findRoundPaperTally(roundId) {
      const [row] = await db
        .select()
        .from(roundPaperTallies)
        .where(eq(roundPaperTallies.roundId, roundId))
        .limit(1);
      return row ? toStoredPaperTally(row) : null;
    },

    async listRoundPaperTallies(roundIds) {
      if (roundIds.length === 0) {
        return [];
      }
      const rows = await db
        .select()
        .from(roundPaperTallies)
        .where(inArray(roundPaperTallies.roundId, [...roundIds]));
      return rows.map(toStoredPaperTally);
    },

    async resolveRoundTie(roomId, roundId, winnerCandidateId) {
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(rounds)
          .set({
            outcome: "elected",
            winnerCandidateId,
            tieBreakReason: "admin_tiebreak",
          })
          .where(
            and(
              eq(rounds.id, roundId),
              eq(rounds.roomId, roomId),
              eq(rounds.status, "closed"),
              eq(rounds.outcome, "no_majority"),
            ),
          )
          .returning();
        const row = updated[0];
        if (!row) {
          return null;
        }

        const roomRows = await tx
          .select({ churchId: rooms.churchId, title: rooms.title })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1);
        const roomMeta = roomRows[0];

        await insertAuditEvent(
          tx,
          roomId,
          "tie_break_resolved",
          {
            roundId: row.id,
            roundNumber: row.number,
            winnerCandidateId,
            tieBreakReason: "admin_tiebreak",
            ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
          },
          {
            churchId: roomMeta?.churchId ?? null,
            roomTitle: roomMeta?.title ?? null,
            actorRole: "admin",
          },
        );

        const restartCounts = await loadRestartCountsByRoom(tx, [roomId]);
        return toStoredRound(row, restartCounts.get(row.id) ?? 0);
      });
    },

    async restartRound(roomId, roundId) {
      return db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId)))
          .for("update")
          .limit(1);
        const existing = existingRows[0];
        if (!existing || existing.status !== "open") {
          return null;
        }

        const ballotRows = await tx
          .select({ candidateId: ballots.candidateId })
          .from(ballots)
          .where(eq(ballots.roundId, roundId));

        let blankVotes = 0;
        const byCandidate: Record<string, number> = {};
        for (const row of ballotRows) {
          if (row.candidateId === null) {
            blankVotes += 1;
          } else {
            byCandidate[row.candidateId] = (byCandidate[row.candidateId] ?? 0) + 1;
          }
        }
        const annulledTotals = {
          totalBallots: ballotRows.length,
          blankVotes,
          byCandidate,
        };

        const now = new Date();
        await tx
          .update(rounds)
          .set({
            status: "restarted",
            outcome: "annulled",
            closedAt: now,
          })
          .where(eq(rounds.id, roundId));

        const roomRoundRows = await tx
          .select({ number: rounds.number })
          .from(rounds)
          .where(eq(rounds.roomId, roomId));
        const nextNumber = roomRoundRows.reduce((max, item) => Math.max(max, item.number), 0) + 1;

        const inserted = await tx
          .insert(rounds)
          .values({
            roomId,
            number: nextNumber,
            officeLabel: existing.officeLabel ?? null,
            status: "open",
            outcome: null,
            openedAt: now,
          })
          .returning();
        const newRound = inserted[0];
        if (!newRound) {
          throw new Error("Restarted round insert returned no row");
        }

        const roomRows = await tx
          .select({ churchId: rooms.churchId, title: rooms.title })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1);
        const roomMeta = roomRows[0];

        await insertAuditEvent(
          tx,
          roomId,
          "round_restarted",
          {
            roundId: newRound.id,
            roundNumber: newRound.number,
            annulledRoundId: existing.id,
            annulledRoundNumber: existing.number,
            annulledTotals,
            ...(newRound.officeLabel !== null ? { officeLabel: newRound.officeLabel } : {}),
          },
          {
            churchId: roomMeta?.churchId ?? null,
            roomTitle: roomMeta?.title ?? null,
            actorRole: "admin",
          },
        );

        const restartCounts = await loadRestartCountsByRoom(tx, [roomId]);
        return toStoredRound(newRound, restartCounts.get(newRound.id) ?? 1);
      });
    },

    async declineRound(roomId, roundId, declinedCandidateId) {
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(rounds)
          .set({
            outcome: "declined",
            declinedCandidateId,
          })
          .where(
            and(
              eq(rounds.id, roundId),
              eq(rounds.roomId, roomId),
              eq(rounds.status, "closed"),
              eq(rounds.outcome, "elected"),
            ),
          )
          .returning();
        const row = updated[0];
        if (!row) {
          return null;
        }

        const roomRows = await tx
          .select({ churchId: rooms.churchId, title: rooms.title })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1);
        const roomMeta = roomRows[0];

        await insertAuditEvent(
          tx,
          roomId,
          "office_declined",
          {
            roundId: row.id,
            roundNumber: row.number,
            declinedCandidateId,
            ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
          },
          {
            churchId: roomMeta?.churchId ?? null,
            roomTitle: roomMeta?.title ?? null,
            actorRole: "admin",
          },
        );

        return toStoredRound(row);
      });
    },

    async findRound(roomId, roundId) {
      const rows = await db
        .select()
        .from(rounds)
        .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      const restartCounts = await loadRestartCountsByRoom(db, [roomId]);
      return toStoredRound(row, restartCounts.get(row.id) ?? 0);
    },

    async listRounds(roomId) {
      const [rows, restartCounts] = await Promise.all([
        db.select().from(rounds).where(eq(rounds.roomId, roomId)).orderBy(asc(rounds.number)),
        loadRestartCountsByRoom(db, [roomId]),
      ]);
      return rows.map((row) => toStoredRound(row, restartCounts.get(row.id) ?? 0));
    },

    async latestRounds(roomIds) {
      if (roomIds.length === 0) {
        return [];
      }

      const [rows, restartCounts] = await Promise.all([
        db
          .select()
          .from(rounds)
          .where(inArray(rounds.roomId, roomIds))
          .orderBy(desc(rounds.number)),
        loadRestartCountsByRoom(db, roomIds),
      ]);
      const seen = new Set<string>();
      const latest: StoredRound[] = [];
      for (const row of rows) {
        if (seen.has(row.roomId)) {
          continue;
        }
        seen.add(row.roomId);
        latest.push(toStoredRound(row, restartCounts.get(row.id) ?? 0));
      }
      return latest;
    },

    async latestClosedRound(roomId) {
      const rows = await db
        .select()
        .from(rounds)
        .where(and(eq(rounds.roomId, roomId), eq(rounds.status, "closed")))
        .orderBy(desc(rounds.number))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      const restartCounts = await loadRestartCountsByRoom(db, [roomId]);
      return toStoredRound(row, restartCounts.get(row.id) ?? 0);
    },

    async listAuditEvents(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return [];
      }
      const rows = await db
        .select({
          id: auditEvents.id,
          roomId: auditEvents.roomId,
          roomTitle: auditEvents.roomTitle,
          actorRole: auditEvents.actorRole,
          action: auditEvents.action,
          payload: auditEvents.payload,
          prevHash: auditEvents.prevHash,
          integrityHash: auditEvents.integrityHash,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .innerJoin(rooms, eq(auditEvents.roomId, rooms.id))
        .where(
          and(
            eq(auditEvents.roomId, roomId),
            eq(rooms.churchId, church.id),
            eq(auditEvents.actorRole, "admin"),
          ),
        )
        .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
      return rows.map(toStoredAuditEvent);
    },

    async listAllAuditEvents(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return [];
      }
      const rows = await db
        .select({
          id: auditEvents.id,
          roomId: auditEvents.roomId,
          roomTitle: auditEvents.roomTitle,
          joinedRoomTitle: rooms.title,
          roomStatus: rooms.status,
          actorRole: auditEvents.actorRole,
          action: auditEvents.action,
          payload: auditEvents.payload,
          prevHash: auditEvents.prevHash,
          integrityHash: auditEvents.integrityHash,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .leftJoin(rooms, eq(auditEvents.roomId, rooms.id))
        .where(
          and(
            or(eq(auditEvents.churchId, church.id), eq(rooms.churchId, church.id)),
            ...(roomId ? [eq(auditEvents.roomId, roomId)] : []),
          ),
        )
        .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
      return rows.map((row) => ({
        ...toStoredAuditEvent(row),
        roomTitle: row.joinedRoomTitle ?? row.roomTitle ?? null,
        roomStatus: (row.roomStatus as RoomStatus | null) ?? null,
      }));
    },

    async verifyAuditChain(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return {
          chainValid: true,
          totalEvents: 0,
          chainTipHash: "GENESIS",
        };
      }
      const rows = await db
        .select({
          id: auditEvents.id,
          roomId: auditEvents.roomId,
          actorRole: auditEvents.actorRole,
          action: auditEvents.action,
          payload: auditEvents.payload,
          prevHash: auditEvents.prevHash,
          integrityHash: auditEvents.integrityHash,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .leftJoin(rooms, eq(auditEvents.roomId, rooms.id))
        .where(
          and(
            or(eq(auditEvents.churchId, church.id), eq(rooms.churchId, church.id)),
            ...(roomId ? [eq(auditEvents.roomId, roomId)] : []),
          ),
        )
        .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));

      return verifyRoomAuditChains(rows);
    },

    async hasSimulatedAccessCodes(roomId) {
      const rows = await db
        .select({ id: roomMemberCodes.id })
        .from(roomMemberCodes)
        .where(and(eq(roomMemberCodes.roomId, roomId), eq(roomMemberCodes.isSimulated, true)))
        .limit(1);
      return Boolean(rows[0]);
    },

    async recordAuditEvent(roomId, action, payload = {}) {
      const church = await findChurchByName(db, churchName);
      const room = await this.findRoomById(roomId);
      if (!room) {
        throw new Error("Cannot record audit event for unknown room");
      }
      const inserted = await insertAuditEvent(db, roomId, action, payload, {
        churchId: church?.id ?? null,
        roomTitle: room.title,
      });
      return toStoredAuditEvent(inserted);
    },

    async castBallot(input) {
      return db.transaction(async (tx) => {
        const roomRows = await tx
          .select({ status: rooms.status, title: rooms.title, churchId: rooms.churchId })
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .limit(1);
        const roomRow = roomRows[0];
        if (!roomRow || !canOpenRound(roomRow.status as RoomStatus)) {
          return { ok: false as const, reason: "room_not_open" as const };
        }

        const roundRows = await tx
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, input.roundId), eq(rounds.roomId, input.roomId)))
          .for("update")
          .limit(1);
        const round = roundRows[0];
        if (!round || round.status !== "open") {
          return { ok: false as const, reason: "round_not_open" as const };
        }

        const participant = await findParticipantByJoinKey(tx, input.roomId, input.joinKeyHash);
        if (!participant || !participant.isPresent) {
          return { ok: false as const, reason: "participant_not_present" as const };
        }

        let isSimulatedVoter = false;
        let isMemberLinked = participant.memberId !== null;
        if (participant.accessCodeId) {
          const codeRows = await tx
            .select({
              revokedAt: roomMemberCodes.revokedAt,
              isSimulated: roomMemberCodes.isSimulated,
              memberId: roomMemberCodes.memberId,
            })
            .from(roomMemberCodes)
            .where(eq(roomMemberCodes.id, participant.accessCodeId))
            .limit(1);
          if (!codeRows[0] || codeRows[0].revokedAt !== null) {
            return { ok: false as const, reason: "access_code_revoked" as const };
          }
          isSimulatedVoter = codeRows[0].isSimulated;
          if (codeRows[0].memberId !== null) {
            isMemberLinked = true;
          }
          if (isSimulatedVoter && roomRow.status !== "test") {
            return { ok: false as const, reason: "room_not_open" as const };
          }
        }

        let isCandidateEligible = true;
        if (input.candidateId !== null) {
          const candidateRows = await tx
            .select()
            .from(candidates)
            .where(
              and(
                eq(candidates.id, input.candidateId),
                eq(candidates.roomId, input.roomId),
                eq(candidates.isEligible, true),
              ),
            )
            .limit(1);
          isCandidateEligible = Boolean(candidateRows[0]);
        }

        const eligibility = canCastBallot({
          roomStatus: roomRow.status,
          roundStatus: round.status,
          isParticipantPresent: Boolean(participant?.isPresent),
          hasAlreadyVoted: false,
          isCandidateEligible,
        });
        if (!eligibility.ok) {
          return { ok: false as const, reason: eligibility.reason };
        }

        const insertedReceipt = await tx
          .insert(voteReceipts)
          .values({
            roundId: input.roundId,
            participantId: participant!.id,
          })
          .onConflictDoNothing()
          .returning({ id: voteReceipts.id });
        if (!insertedReceipt[0]) {
          return { ok: false as const, reason: "already_voted" as const };
        }

        await tx.insert(ballots).values({
          roundId: input.roundId,
          candidateId: input.candidateId,
        });

        await insertAuditEvent(
          tx,
          input.roomId,
          "ballot_cast",
          {
            roundId: round.id,
            roundNumber: round.number,
            ...(round.officeLabel !== null ? { officeLabel: round.officeLabel } : {}),
            roomStatus: roomRow.status,
            voterOrigin: isSimulatedVoter ? "test_simulator" : "authenticated_member",
            isSimulated: isSimulatedVoter,
            memberVerified: !isSimulatedVoter && isMemberLinked,
            adminIntervention: false,
          },
          {
            churchId: roomRow.churchId,
            roomTitle: roomRow.title,
            actorRole: isSimulatedVoter ? "simulated_voter" : "voter",
          },
        );

        return { ok: true as const, roundId: input.roundId };
      });
    },

    async hasVotedInRound(roomId, roundId, joinKeyHash) {
      const participant = await findParticipantByJoinKey(db, roomId, joinKeyHash);
      if (!participant) {
        return false;
      }

      const rows = await db
        .select({ id: voteReceipts.id })
        .from(voteReceipts)
        .where(
          and(
            eq(voteReceipts.roundId, roundId),
            eq(voteReceipts.participantId, participant.id),
          ),
        )
        .limit(1);
      return Boolean(rows[0]);
    },

    async listRoundBallotCandidateIds(roundId) {
      const rows = await db
        .select({ candidateId: ballots.candidateId })
        .from(ballots)
        .where(eq(ballots.roundId, roundId))
        .orderBy(asc(ballots.candidateId));
      return rows.map((row) => row.candidateId);
    },

    async listRoundReceiptTimestamps(roundId) {
      const rows = await db
        .select({ castAt: voteReceipts.castAt })
        .from(voteReceipts)
        .where(eq(voteReceipts.roundId, roundId))
        .orderBy(desc(voteReceipts.castAt));
      return rows.map((row) => row.castAt);
    },

    async importMembers(rows) {
      if (rows.length === 0) {
        return { createdCount: 0, updatedCount: 0 };
      }

      const churchId = await getOrCreateChurch(db, churchName);
      return db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(members)
          .where(and(eq(members.churchId, churchId), isNull(members.deletedAt)));
        const existingByName = new Map(
          existingRows.map((row) => [row.fullName.toLocaleLowerCase(), row]),
        );

        let createdCount = 0;
        let updatedCount = 0;

        for (const row of rows) {
          const key = row.fullName.toLocaleLowerCase();
          const birthDate = row.birthDate ? new Date(`${row.birthDate}T00:00:00.000Z`) : null;
          const existing = existingByName.get(key);

          if (existing) {
            const updated = await tx
              .update(members)
              .set({
                fullName: row.fullName,
                isCommunicant: row.isCommunicant,
                isMale: row.isMale,
                birthDate,
                photoUrl: row.photoUrl,
                societyFlags: row.societyFlags,
              })
              .where(eq(members.id, existing.id))
              .returning();
            if (updated[0]) {
              existingByName.set(key, updated[0]);
            }
            updatedCount += 1;
          } else {
            const inserted = await tx
              .insert(members)
              .values({
                churchId,
                fullName: row.fullName,
                isCommunicant: row.isCommunicant,
                isMale: row.isMale,
                birthDate,
                photoUrl: row.photoUrl,
                societyFlags: row.societyFlags,
              })
              .returning();
            if (inserted[0]) {
              existingByName.set(key, inserted[0]);
            }
            createdCount += 1;
          }
        }

        return { createdCount, updatedCount };
      });
    },

    async createMember(input) {
      const churchId = await getOrCreateChurch(db, churchName);
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(members)
          .values({
            churchId,
            fullName: input.fullName,
            isCommunicant: input.isCommunicant,
            isMale: input.isMale,
            birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
            photoUrl: input.photoUrl ?? null,
            societyFlags: input.societyFlags ?? {},
          })
          .returning();
        return toStoredMember(inserted[0]!);
      });
    },

    async updateMember(memberId, input) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }
      const parsedBirthDate = input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null;
      const nextFlags = input.societyFlags ?? {};
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(members)
          .set({
            fullName: input.fullName,
            isCommunicant: input.isCommunicant,
            isMale: input.isMale,
            birthDate: parsedBirthDate,
            photoUrl: input.photoUrl ?? null,
            societyFlags: nextFlags,
          })
          .where(
            and(
              eq(members.id, memberId),
              eq(members.churchId, church.id),
              isNull(members.deletedAt),
            ),
          )
          .returning();
        const updatedMember = updated[0];
        if (!updatedMember) {
          return null;
        }

        // Propagate ONLY to non-closed rooms with 0 rounds.
        const openRooms = await tx
          .select({ id: rooms.id, roomType: rooms.roomType })
          .from(rooms)
          .where(and(eq(rooms.churchId, church.id), ne(rooms.status, "closed")));

        if (openRooms.length > 0) {
          const roundRooms = await tx
            .selectDistinct({ roomId: rounds.roomId })
            .from(rounds)
            .where(inArray(rounds.roomId, openRooms.map((row) => row.id)));
          const roomsWithRounds = new Set(roundRooms.map((row) => row.roomId));
          const untouchedRooms = openRooms.filter((row) => !roomsWithRounds.has(row.id));
          const untouchedRoomIds = untouchedRooms.map((row) => row.id);

          if (untouchedRoomIds.length > 0) {
            await tx
              .update(candidates)
              .set({
                displayName: input.fullName,
                photoUrl: input.photoUrl ?? null,
                birthDate: parsedBirthDate,
              })
              .where(
                and(
                  eq(candidates.memberId, memberId),
                  inArray(candidates.roomId, untouchedRoomIds),
                ),
              );

            await tx
              .update(roomMemberCodes)
              .set({ displayName: input.fullName })
              .where(
                and(
                  eq(roomMemberCodes.memberId, memberId),
                  inArray(roomMemberCodes.roomId, untouchedRoomIds),
                  isNull(roomMemberCodes.revokedAt),
                ),
              );

            for (const untouchedRoom of untouchedRooms) {
              const isEligibleVoter = isMemberEligibleVoter(
                {
                  isCommunicant: input.isCommunicant,
                  societyFlags: nextFlags,
                },
                untouchedRoom.roomType as RoomType,
              );
              const updatedRoster = await tx
                .update(roomRoster)
                .set({
                  fullName: input.fullName,
                  photoUrl: input.photoUrl ?? null,
                  birthDate: parsedBirthDate,
                  isCommunicant: input.isCommunicant,
                  isMale: input.isMale,
                  societyFlags: nextFlags,
                  isEligibleVoter,
                })
                .where(
                  and(
                    eq(roomRoster.roomId, untouchedRoom.id),
                    eq(roomRoster.memberId, memberId),
                    isNull(roomRoster.removedAt),
                  ),
                )
                .returning({ id: roomRoster.id });

              if (updatedRoster.length > 0) {
                await recalculateRoomEligibleCount(tx, untouchedRoom.id);
              }
            }
          }
        }

        return toStoredMember(updatedMember);
      });
    },

    async deleteMember(memberId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return false;
      }
      return db.transaction(async (tx) => {
        const now = new Date();
        const softDeleted = await tx
          .update(members)
          .set({ deletedAt: now })
          .where(
            and(
              eq(members.id, memberId),
              eq(members.churchId, church.id),
              isNull(members.deletedAt),
            ),
          )
          .returning({ id: members.id });
        if (softDeleted.length === 0) {
          return false;
        }

        const openRooms = await tx
          .select({ id: rooms.id })
          .from(rooms)
          .where(and(eq(rooms.churchId, church.id), ne(rooms.status, "closed")));
        const openRoomIds = openRooms.map((row) => row.id);

        if (openRoomIds.length > 0) {
          const removedRoster = await tx
            .update(roomRoster)
            .set({ removedAt: now })
            .where(
              and(
                inArray(roomRoster.roomId, openRoomIds),
                eq(roomRoster.memberId, memberId),
                isNull(roomRoster.removedAt),
              ),
            )
            .returning({ roomId: roomRoster.roomId });

          await tx
            .update(roomMemberCodes)
            .set({ revokedAt: now })
            .where(
              and(
                inArray(roomMemberCodes.roomId, openRoomIds),
                eq(roomMemberCodes.memberId, memberId),
                isNull(roomMemberCodes.revokedAt),
              ),
            );

          await tx
            .update(participants)
            .set({ isPresent: false, joinKeyHash: null })
            .where(
              and(
                inArray(participants.roomId, openRoomIds),
                eq(participants.memberId, memberId),
              ),
            );

          const affectedRoomIds = Array.from(new Set(removedRoster.map((row) => row.roomId)));
          for (const affectedRoomId of affectedRoomIds) {
            await recalculateRoomEligibleCount(tx, affectedRoomId);
          }
        }

        return true;
      });
    },

    async listMembers() {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return [];
      }

      const rows = await db
        .select()
        .from(members)
        .where(and(eq(members.churchId, church.id), isNull(members.deletedAt)))
        .orderBy(asc(members.fullName));
      return rows.map(toStoredMember);
    },

    async listChatMessages(roomId, limit = 100) {
      const rows = await db
        .select()
        .from(roomChatMessages)
        .where(eq(roomChatMessages.roomId, roomId))
        .orderBy(desc(roomChatMessages.createdAt))
        .limit(limit);
      return rows.reverse().map((row) => ({
        id: row.id,
        roomId: row.roomId,
        participantId: row.participantId,
        senderName: row.senderName,
        senderRole: row.senderRole === "admin" ? ("admin" as const) : ("voter" as const),
        content: row.content,
        createdAt: row.createdAt,
      }));
    },

    async sendVoterChatMessage({ roomId, joinKeyHash, content, since, maxPerWindow }) {
      return db.transaction(async (tx) => {
        const [roomRow] = await tx
          .select({ chatMuted: rooms.chatMuted })
          .from(rooms)
          .where(eq(rooms.id, roomId))
          .limit(1);
        if (!roomRow || roomRow.chatMuted) {
          return { ok: false, reason: "room_chat_muted" } as const;
        }

        const [participant] = await tx
          .select()
          .from(participants)
          .where(and(eq(participants.roomId, roomId), eq(participants.joinKeyHash, joinKeyHash)))
          .for("update")
          .limit(1);

        if (!participant || !participant.isPresent) {
          return { ok: false, reason: "participant_not_in_room" } as const;
        }
        if (participant.chatMuted) {
          return { ok: false, reason: "participant_muted" } as const;
        }

        if (participant.accessCodeId) {
          const [codeRow] = await tx
            .select({ revokedAt: roomMemberCodes.revokedAt })
            .from(roomMemberCodes)
            .where(eq(roomMemberCodes.id, participant.accessCodeId))
            .limit(1);
          if (!codeRow || codeRow.revokedAt !== null) {
            return { ok: false, reason: "participant_not_in_room" } as const;
          }
        }

        const [recent] = await tx
          .select({ total: count() })
          .from(roomChatMessages)
          .where(
            and(
              eq(roomChatMessages.roomId, roomId),
              eq(roomChatMessages.participantId, participant.id),
              gte(roomChatMessages.createdAt, since),
            ),
          );

        if (isChatRateLimited(recent?.total ?? 0, maxPerWindow)) {
          return { ok: false, reason: "rate_limited" } as const;
        }

        const [inserted] = await tx
          .insert(roomChatMessages)
          .values({
            roomId,
            participantId: participant.id,
            senderName: participant.displayName,
            senderRole: "voter",
            content,
          })
          .returning();

        return {
          ok: true,
          message: {
            id: inserted!.id,
            roomId: inserted!.roomId,
            participantId: inserted!.participantId,
            senderName: inserted!.senderName,
            senderRole: "voter" as const,
            content: inserted!.content,
            createdAt: inserted!.createdAt,
          },
        } as const;
      });
    },

    async sendAdminChatMessage({ roomId, senderName, content }) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }
      const [roomRow] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
        .limit(1);
      if (!roomRow) {
        return null;
      }
      const [inserted] = await db
        .insert(roomChatMessages)
        .values({
          roomId,
          participantId: null,
          senderName,
          senderRole: "admin",
          content,
        })
        .returning();
      return inserted
        ? {
            id: inserted.id,
            roomId: inserted.roomId,
            participantId: null,
            senderName: inserted.senderName,
            senderRole: "admin" as const,
            content: inserted.content,
            createdAt: inserted.createdAt,
          }
        : null;
    },

    async listParticipants(roomId) {
      const rows = await db
        .select({
          id: participants.id,
          displayName: participants.displayName,
          isPresent: participants.isPresent,
          chatMuted: participants.chatMuted,
          joinedAt: participants.joinedAt,
        })
        .from(participants)
        .where(eq(participants.roomId, roomId))
        .orderBy(asc(participants.joinedAt));
      return rows;
    },

    async setParticipantChatMuted(roomId, participantId, chatMuted) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return null;
      }
      const [roomRow] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
        .limit(1);
      if (!roomRow) {
        return null;
      }
      const [updated] = await db
        .update(participants)
        .set({ chatMuted })
        .where(and(eq(participants.id, participantId), eq(participants.roomId, roomId)))
        .returning({
          id: participants.id,
          displayName: participants.displayName,
          isPresent: participants.isPresent,
          chatMuted: participants.chatMuted,
          joinedAt: participants.joinedAt,
        });
      return updated ?? null;
    },

    async findParticipantChatStatus(roomId, joinKeyHash) {
      const [row] = await db
        .select({
          id: participants.id,
          chatMuted: participants.chatMuted,
        })
        .from(participants)
        .where(and(eq(participants.roomId, roomId), eq(participants.joinKeyHash, joinKeyHash)))
        .limit(1);
      return row ?? null;
    },

    async deleteChatMessage(roomId, messageId) {
      const deleted = await db
        .delete(roomChatMessages)
        .where(and(eq(roomChatMessages.id, messageId), eq(roomChatMessages.roomId, roomId)))
        .returning({ id: roomChatMessages.id });
      return deleted.length > 0;
    },
  };
}

function toStoredCandidate(row: {
  id: string;
  roomId: string;
  memberId?: string | null;
  displayName: string;
  photoUrl?: string | null;
  birthDate?: Date | null;
  isEligible: boolean;
}): StoredCandidate {
  return {
    id: row.id,
    roomId: row.roomId,
    ...(row.memberId !== undefined ? { memberId: row.memberId } : {}),
    displayName: row.displayName,
    photoUrl: row.photoUrl ?? null,
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    isEligible: row.isEligible,
  };
}

function toStoredRosterEntry(
  row: {
    id: string;
    roomId: string;
    memberId: string | null;
    fullName: string;
    birthDate: Date | null;
    isCommunicant: boolean;
    isMale: boolean | null;
    isEligibleVoter: boolean;
    votesOnPaper: boolean;
    createdAt: Date;
  },
  accessCode: { id: string; code: string; revokedAt: Date | null } | null,
  isPresent: boolean,
): StoredRosterEntry {
  return {
    id: row.id,
    roomId: row.roomId,
    memberId: row.memberId,
    fullName: row.fullName,
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    isCommunicant: row.isCommunicant,
    isMale: row.isMale,
    isEligibleVoter: row.isEligibleVoter,
    votesOnPaper: row.votesOnPaper,
    createdAt: row.createdAt,
    accessCode: accessCode
      ? {
          id: accessCode.id,
          code: accessCode.code,
          revokedAt: accessCode.revokedAt,
        }
      : null,
    isPresent,
  };
}

function toStoredPaperTally(row: {
  id: string;
  roundId: string;
  ballotCount: number;
  blankVotes: number;
  nullVotes: number;
  candidateVotes: Record<string, number>;
  recordedByAdminId: string | null;
  recordedByName: string | null;
  recordedAt: Date;
  updatedAt: Date;
}): StoredPaperTally {
  return {
    id: row.id,
    roundId: row.roundId,
    ballotCount: row.ballotCount,
    blankVotes: row.blankVotes,
    nullVotes: row.nullVotes,
    candidateVotes: row.candidateVotes ?? {},
    recordedByAdminId: row.recordedByAdminId ?? null,
    recordedByName: row.recordedByName ?? null,
    recordedAt: row.recordedAt,
    updatedAt: row.updatedAt,
  };
}

async function recalculateRoomEligibleCount(tx: DbTransaction, roomId: string): Promise<number> {
  const rows = await tx
    .select({ value: count() })
    .from(roomRoster)
    .where(
      and(
        eq(roomRoster.roomId, roomId),
        isNull(roomRoster.removedAt),
        eq(roomRoster.isEligibleVoter, true),
      ),
    );
  const eligibleCount = Number(rows[0]?.value ?? 0);
  await tx.update(rooms).set({ eligibleCount }).where(eq(rooms.id, roomId));
  return eligibleCount;
}

function toStoredMember(row: {
  id: string;
  fullName: string;
  isCommunicant: boolean;
  isMale: boolean | null;
  birthDate: Date | null;
  photoUrl?: string | null;
  societyFlags: Record<string, unknown> | null;
  createdAt: Date;
}): StoredMember {
  const rawFlags = row.societyFlags ?? {};
  const societyFlags: MemberSocietyFlags = {
    ...(typeof rawFlags.upaActive === "boolean" ? { upaActive: rawFlags.upaActive } : {}),
    ...(typeof rawFlags.upaEnrolledAt === "string"
      ? { upaEnrolledAt: rawFlags.upaEnrolledAt }
      : {}),
    ...(typeof rawFlags.umpActive === "boolean" ? { umpActive: rawFlags.umpActive } : {}),
    ...(typeof rawFlags.umpEnrolledAt === "string"
      ? { umpEnrolledAt: rawFlags.umpEnrolledAt }
      : {}),
  };

  return {
    id: row.id,
    fullName: row.fullName,
    isCommunicant: row.isCommunicant,
    isMale: row.isMale,
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    photoUrl: row.photoUrl ?? null,
    societyFlags,
    createdAt: row.createdAt,
  };
}

async function findParticipantByJoinKey(
  db: Pick<Db, "select">,
  roomId: string,
  joinKeyHash: string,
) {
  const rows = await db
    .select()
    .from(participants)
    .where(and(eq(participants.roomId, roomId), eq(participants.joinKeyHash, joinKeyHash)))
    .limit(1);
  return rows[0] ?? null;
}

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function joinParticipantInTransaction(
  tx: DbTransaction,
  roomId: string,
  room: { id: string; title: string; status: string; churchId: string } | undefined,
  rawCode: string,
  joinKeyHash: string,
): Promise<JoinWithCodeResult> {
  const code = normalizeAccessCode(rawCode);
  const codeRows = await tx
    .select()
    .from(roomMemberCodes)
    .where(and(eq(roomMemberCodes.roomId, roomId), eq(roomMemberCodes.code, code)))
    .limit(1)
    .for("update");
  const codeRow = codeRows[0];
  if (!codeRow) {
    return { ok: false, reason: "invalid_access_code" };
  }
  if (codeRow.revokedAt !== null) {
    return { ok: false, reason: "revoked_access_code" };
  }
  if (codeRow.isSimulated && room && room.status !== "test") {
    return { ok: false, reason: "simulation_requires_test_room" };
  }

  const existingByCode = await tx
    .select()
    .from(participants)
    .where(and(eq(participants.roomId, roomId), eq(participants.accessCodeId, codeRow.id)))
    .for("update")
    .limit(1);
  const existingByMember =
    !existingByCode[0] && codeRow.memberId
      ? await tx
          .select()
          .from(participants)
          .where(and(eq(participants.roomId, roomId), eq(participants.memberId, codeRow.memberId)))
          .for("update")
          .limit(1)
      : [];
  const existing = existingByCode[0] ?? existingByMember[0];

  if (existing) {
    if (existing.joinKeyHash !== null && existing.joinKeyHash !== joinKeyHash) {
      return { ok: false, reason: "access_code_in_use" };
    }

    const existingByJoinKey = await findParticipantByJoinKey(tx, roomId, joinKeyHash);
    if (existingByJoinKey && existingByJoinKey.id !== existing.id) {
      return { ok: false, reason: "access_code_in_use" };
    }

    const isSameSession = existing.joinKeyHash === joinKeyHash;
    const updated = await tx
      .update(participants)
      .set({
        accessCodeId: codeRow.id,
        rosterEntryId: codeRow.rosterEntryId ?? null,
        displayName: codeRow.displayName,
        joinKeyHash,
        isPresent: true,
      })
      .where(eq(participants.id, existing.id))
      .returning();
    const row = updated[0] ?? existing;
    await insertAuditEvent(
      tx,
      roomId,
      "participant_joined",
      {
        roomStatus: room?.status ?? "open",
        voterOrigin: codeRow.isSimulated ? "test_simulator" : "authenticated_member",
        isSimulated: codeRow.isSimulated,
        memberVerified: !codeRow.isSimulated && codeRow.memberId !== null,
        sessionFingerprint: joinKeyHash.slice(0, 12),
        alreadyJoined: isSameSession,
        adminIntervention: false,
      },
      {
        churchId: room?.churchId ?? null,
        roomTitle: room?.title ?? null,
        actorRole: codeRow.isSimulated ? "simulated_voter" : "voter",
      },
    );
    return {
      ok: true,
      participant: {
        id: row.id,
        roomId: row.roomId,
        displayName: row.displayName,
        alreadyJoined: isSameSession,
      },
    };
  }

  const existingByJoinKey = await findParticipantByJoinKey(tx, roomId, joinKeyHash);
  if (existingByJoinKey) {
    return { ok: false, reason: "access_code_in_use" };
  }

  const inserted = await tx
    .insert(participants)
    .values({
      roomId,
      memberId: codeRow.memberId,
      accessCodeId: codeRow.id,
      rosterEntryId: codeRow.rosterEntryId ?? null,
      displayName: codeRow.displayName,
      joinKeyHash,
      isPresent: true,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("Participant insert returned no row");
  }
  await insertAuditEvent(
    tx,
    roomId,
    "participant_joined",
    {
      roomStatus: room?.status ?? "open",
      voterOrigin: codeRow.isSimulated ? "test_simulator" : "authenticated_member",
      isSimulated: codeRow.isSimulated,
      memberVerified: !codeRow.isSimulated && codeRow.memberId !== null,
      sessionFingerprint: joinKeyHash.slice(0, 12),
      alreadyJoined: false,
      adminIntervention: false,
    },
    {
      churchId: room?.churchId ?? null,
      roomTitle: room?.title ?? null,
      actorRole: codeRow.isSimulated ? "simulated_voter" : "voter",
    },
  );
  return {
    ok: true,
    participant: {
      id: row.id,
      roomId: row.roomId,
      displayName: row.displayName,
      alreadyJoined: false,
    },
  };
}

function toStoredRoom(row: {
  id: string;
  title: string;
  roomType: string;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  eligibleCount: number;
  officeBanners?: Record<string, string> | null;
  inviteToken: string;
  shortCode: string;
  status: string;
  reactionsEnabled: boolean;
  chatMuted?: boolean;
  createdAt: Date;
}): StoredRoom {
  return {
    id: row.id,
    title: row.title,
    roomType: row.roomType as RoomType,
    rulesPreset: row.rulesPreset,
    quorumValue: row.quorumValue,
    quorumUnit: row.quorumUnit,
    eligibleCount: row.eligibleCount,
    officeBanners: row.officeBanners ?? {},
    inviteToken: row.inviteToken,
    shortCode: row.shortCode,
    status: row.status as RoomStatus,
    reactionsEnabled: row.reactionsEnabled,
    chatMuted: row.chatMuted ?? false,
    createdAt: row.createdAt,
  };
}

function toStoredRound(
  row: {
    id: string;
    roomId: string;
    number: number;
    officeLabel: string | null;
    status: StoredRoundStatus;
    outcome: string | null;
    declinedCandidateId?: string | null;
    winnerCandidateId?: string | null;
    tieBreakReason?: string | null;
    didNotVoteCount?: number | null;
    openedAt: Date | null;
    closedAt: Date | null;
  },
  restartCount = 0,
): StoredRound {
  return {
    id: row.id,
    roomId: row.roomId,
    number: row.number,
    officeLabel: row.officeLabel ?? null,
    status: row.status,
    outcome: toRoundResult(row.outcome),
    declinedCandidateId: row.declinedCandidateId ?? null,
    winnerCandidateId: row.winnerCandidateId ?? null,
    tieBreakReason:
      row.tieBreakReason === "age" || row.tieBreakReason === "admin_tiebreak"
        ? row.tieBreakReason
        : null,
    ...(row.didNotVoteCount !== undefined && row.didNotVoteCount !== null
      ? { didNotVoteCount: row.didNotVoteCount }
      : {}),
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    ...(restartCount > 0 ? { restartCount } : {}),
  };
}

function toStoredAuditEvent(row: {
  id: string;
  roomId: string;
  roomTitle?: string | null;
  actorRole: string;
  action: string;
  payload: Record<string, unknown> | null;
  prevHash?: string | null;
  integrityHash?: string | null;
  createdAt: Date;
}): StoredAuditEvent {
  return {
    id: row.id,
    roomId: row.roomId,
    roomTitle: row.roomTitle ?? null,
    actorRole: row.actorRole,
    action: row.action,
    payload: row.payload ?? {},
    ...(row.prevHash !== undefined ? { prevHash: row.prevHash } : {}),
    ...(row.integrityHash ? { integrityHash: row.integrityHash } : {}),
    createdAt: row.createdAt,
  };
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}

export function computeAuditIntegrityHash(input: {
  prevHash: string;
  id: string;
  roomId: string;
  actorRole: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}): string {
  const iso = input.createdAt.toISOString();
  const canonicalPayload = stableJsonStringify(input.payload);
  return createHash("sha256")
    .update(
      `${input.prevHash}:${input.id}:${input.roomId}:${input.actorRole}:${input.action}:${canonicalPayload}:${iso}`,
    )
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function verifyRoomAuditChains(
  rows: Array<{
    id: string;
    roomId: string;
    actorRole: string;
    action: string;
    payload: Record<string, unknown> | null;
    prevHash: string | null;
    integrityHash: string;
    createdAt: Date;
  }>,
): AuditChainVerificationResult {
  const prevByRoom = new Map<string, string>();
  let chainValid = true;
  let brokenAtEventId: string | null = null;
  let chainTipHash = "GENESIS";

  for (const row of rows) {
    const expectedPrev = prevByRoom.get(row.roomId) ?? "GENESIS";
    const expectedHash = computeAuditIntegrityHash({
      prevHash: expectedPrev,
      id: row.id,
      roomId: row.roomId,
      actorRole: row.actorRole,
      action: row.action,
      payload: row.payload ?? {},
      createdAt: row.createdAt,
    });

    const actualPrev = row.prevHash ?? "GENESIS";
    if (actualPrev !== expectedPrev || row.integrityHash !== expectedHash) {
      if (chainValid) {
        chainValid = false;
        brokenAtEventId = row.id;
      }
    }

    prevByRoom.set(row.roomId, row.integrityHash);
    chainTipHash = row.integrityHash;
  }

  return {
    chainValid,
    totalEvents: rows.length,
    chainTipHash,
    ...(brokenAtEventId !== null ? { brokenAtEventId } : {}),
  };
}

async function loadRestartCountsByRoom(
  db: Pick<Db, "select">,
  roomIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (roomIds.length === 0) {
    return counts;
  }

  const rows = await db
    .select({ roomId: auditEvents.roomId, payload: auditEvents.payload })
    .from(auditEvents)
    .where(and(inArray(auditEvents.roomId, roomIds), eq(auditEvents.action, "round_restarted")));

  const roomRestartTotals = new Map<string, number>();
  const officeRestartTotals = new Map<string, number>();
  for (const row of rows) {
    const officeLabel =
      typeof row.payload?.officeLabel === "string" ? row.payload.officeLabel : null;
    if (officeLabel !== null) {
      const key = `${row.roomId}::${officeLabel}`;
      officeRestartTotals.set(key, (officeRestartTotals.get(key) ?? 0) + 1);
    } else {
      roomRestartTotals.set(row.roomId, (roomRestartTotals.get(row.roomId) ?? 0) + 1);
    }
    const roundId = row.payload?.roundId;
    if (typeof roundId === "string") {
      const total =
        officeLabel !== null
          ? (officeRestartTotals.get(`${row.roomId}::${officeLabel}`) ?? 1)
          : (roomRestartTotals.get(row.roomId) ?? 1);
      counts.set(roundId, total);
    }
  }
  return counts;
}

function toRoundResult(value: string | null): RoundResult | null {
  if (value === null) {
    return null;
  }
  if ((ROUND_RESULTS as readonly string[]).includes(value)) {
    return value as RoundResult;
  }
  throw new Error("Round outcome is not recognized");
}

function allocateUniqueCode(used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = generateAccessCode();
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique access code");
}

function toStoredAccessCode(row: {
  id: string;
  roomId: string;
  rosterEntryId?: string | null;
  memberId: string | null;
  displayName: string;
  code: string;
  isSimulated: boolean;
  revokedAt: Date | null;
  createdAt: Date;
}): StoredAccessCode {
  return {
    id: row.id,
    roomId: row.roomId,
    ...(row.rosterEntryId !== undefined ? { rosterEntryId: row.rosterEntryId } : {}),
    memberId: row.memberId,
    displayName: row.displayName,
    code: row.code,
    isSimulated: row.isSimulated,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

async function insertAuditEvent(
  executor: Pick<Db, "insert" | "select">,
  roomId: string,
  action: string,
  payload: Record<string, unknown>,
  meta?: {
    churchId?: string | null;
    roomTitle?: string | null;
    actorRole?: string;
  },
) {
  // Serialize concurrent audit inserts for the same room so the hash chain never forks
  await executor
    .select({ id: rooms.id })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .for("update")
    .limit(1);

  const prevRows = await executor
    .select({ integrityHash: auditEvents.integrityHash })
    .from(auditEvents)
    .where(eq(auditEvents.roomId, roomId))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(1);
  const prevHash = prevRows[0]?.integrityHash ?? "GENESIS";
  const id = randomUUID();
  const createdAt = new Date();
  const actorRole = meta?.actorRole ?? "admin";
  const integrityHash = computeAuditIntegrityHash({
    prevHash,
    id,
    roomId,
    actorRole,
    action,
    payload,
    createdAt,
  });

  const [inserted] = await executor
    .insert(auditEvents)
    .values({
      id,
      churchId: meta?.churchId ?? null,
      roomId,
      roomTitle: meta?.roomTitle ?? null,
      actorRole,
      action,
      payload,
      prevHash,
      integrityHash,
      createdAt,
    })
    .returning();
  if (!inserted) {
    throw new Error("Audit event insert returned no row");
  }
  return inserted;
}
