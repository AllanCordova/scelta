import {
  auditEvents,
  ballots,
  candidates,
  members,
  participants,
  reactions,
  roomMemberCodes,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import {
  canCastBallot,
  isMemberEligibleVoter,
  isReactionRateLimited,
  normalizeAccessCode,
  ROUND_RESULTS,
  type MemberSocietyFlags,
  type QuorumUnit,
  type RoomStatus,
  type RoomType,
  type RoundResult,
  type RulesPreset,
} from "@scelta/domain";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { findChurchByName, getOrCreateChurch, isUniqueViolation } from "../churches/church-store.js";
import { generateAccessCode } from "./access-code.js";
import { createBallotToken } from "./ballot-token.js";
import { createInviteToken } from "./invite-token.js";
import type {
  RoomRepository,
  StoredAccessCode,
  StoredAuditEvent,
  StoredCandidate,
  StoredMember,
  StoredRound,
  StoredRoundStatus,
  StoredRoom,
} from "./room-repository.js";

const INVITE_TOKEN_ATTEMPTS = 3;

export function createDrizzleRoomRepository(db: Db, churchName: string): RoomRepository {
  return {
    async createRoom(room) {
      const churchId = await getOrCreateChurch(db, churchName);

      for (let attempt = 0; attempt < INVITE_TOKEN_ATTEMPTS; attempt += 1) {
        const inviteToken = createInviteToken();
        try {
          return await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(rooms)
              .values({
                churchId,
                title: room.title,
                roomType: room.roomType,
                rulesPreset: room.rulesPreset,
                quorumValue: room.quorumValue,
                quorumUnit: room.quorumUnit,
                eligibleCount: room.eligibleCount,
                inviteToken,
                status: room.status,
              })
              .returning();

            const row = inserted[0];
            if (!row) {
              throw new Error("Room insert returned no row");
            }

            if (room.candidates && room.candidates.length > 0) {
              const churchMembers = await tx
                .select({
                  id: members.id,
                  fullName: members.fullName,
                  photoUrl: members.photoUrl,
                })
                .from(members)
                .where(eq(members.churchId, churchId));
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
                    isEligible: true,
                  };
                }),
              );
            }

            await insertAuditEvent(tx, row.id, "room_created", {
              title: row.title,
              roomType: row.roomType,
              rulesPreset: row.rulesPreset,
              quorumValue: row.quorumValue,
              quorumUnit: row.quorumUnit,
              eligibleCount: row.eligibleCount,
              status: row.status,
            });

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
          await insertAuditEvent(tx, updated.id, "quorum_changed", {
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
          });
        }

        if (existing.status !== updated.status) {
          await insertAuditEvent(tx, updated.id, "room_status_changed", {
            previous: existing.status,
            next: updated.status,
          });
        }

        return toStoredRoom(updated);
      });
    },

    async deleteRoom(roomId) {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return false;
      }

      return db.transaction(async (tx) => {
        const existingRows = await tx
          .select({ id: rooms.id })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .limit(1);
        if (!existingRows[0]) {
          return false;
        }

        const roomRoundRows = await tx
          .select({ id: rounds.id })
          .from(rounds)
          .where(eq(rounds.roomId, roomId));
        const roundIds = roomRoundRows.map((round) => round.id);
        if (roundIds.length > 0) {
          await tx.delete(ballots).where(inArray(ballots.roundId, roundIds));
          await tx.delete(voteReceipts).where(inArray(voteReceipts.roundId, roundIds));
        }

        await tx.delete(reactions).where(eq(reactions.roomId, roomId));
        await tx.delete(auditEvents).where(eq(auditEvents.roomId, roomId));
        await tx.delete(rounds).where(eq(rounds.roomId, roomId));
        await tx.delete(candidates).where(eq(candidates.roomId, roomId));
        await tx.delete(participants).where(eq(participants.roomId, roomId));
        await tx.delete(roomMemberCodes).where(eq(roomMemberCodes.roomId, roomId));
        const deleted = await tx
          .delete(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .returning({ id: rooms.id });
        return Boolean(deleted[0]);
      });
    },

    async joinRoomWithCode(roomId, rawCode, joinKeyHash) {
      const code = normalizeAccessCode(rawCode);
      return db.transaction(async (tx) => {
        const codeRows = await tx
          .select()
          .from(roomMemberCodes)
          .where(and(eq(roomMemberCodes.roomId, roomId), eq(roomMemberCodes.code, code)))
          .limit(1);
        const codeRow = codeRows[0];
        if (!codeRow) {
          return { ok: false as const, reason: "invalid_access_code" as const };
        }
        if (codeRow.revokedAt !== null) {
          return { ok: false as const, reason: "revoked_access_code" as const };
        }

        const existingByCode = await tx
          .select()
          .from(participants)
          .where(and(eq(participants.roomId, roomId), eq(participants.accessCodeId, codeRow.id)))
          .limit(1);
        const existingByMember =
          !existingByCode[0] && codeRow.memberId
            ? await tx
                .select()
                .from(participants)
                .where(and(eq(participants.roomId, roomId), eq(participants.memberId, codeRow.memberId)))
                .limit(1)
            : [];
        const existing = existingByCode[0] ?? existingByMember[0];

        if (existing) {
          const updated = await tx
            .update(participants)
            .set({
              accessCodeId: codeRow.id,
              displayName: codeRow.displayName,
              joinKeyHash,
              isPresent: true,
            })
            .where(eq(participants.id, existing.id))
            .returning();
          const row = updated[0] ?? existing;
          return {
            ok: true as const,
            participant: {
              id: row.id,
              roomId: row.roomId,
              displayName: row.displayName,
              alreadyJoined: true,
            },
          };
        }

        const inserted = await tx
          .insert(participants)
          .values({
            roomId,
            memberId: codeRow.memberId,
            accessCodeId: codeRow.id,
            displayName: codeRow.displayName,
            joinKeyHash,
            isPresent: true,
          })
          .returning();
        const row = inserted[0];
        if (!row) {
          throw new Error("Participant insert returned no row");
        }
        return {
          ok: true as const,
          participant: {
            id: row.id,
            roomId: row.roomId,
            displayName: row.displayName,
            alreadyJoined: false,
          },
        };
      });
    },

    async generateMemberAccessCodes(roomId) {
      return db.transaction(async (tx) => {
        const roomRows = await tx.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
        const room = roomRows[0];
        if (!room) {
          return [];
        }

        const churchMembers = await tx
          .select()
          .from(members)
          .where(eq(members.churchId, room.churchId))
          .orderBy(asc(members.fullName));

        const eligibleMembers = churchMembers.filter((member) =>
          isMemberEligibleVoter(
            {
              isCommunicant: member.isCommunicant,
              societyFlags: (member.societyFlags ?? {}) as MemberSocietyFlags,
            },
            room.roomType as RoomType,
          ),
        );

        const existingCodes = await tx
          .select()
          .from(roomMemberCodes)
          .where(eq(roomMemberCodes.roomId, roomId));

        const usedCodeStrings = new Set(existingCodes.map((row) => row.code));
        const activeMemberIds = new Set(
          existingCodes
            .filter((row) => row.revokedAt === null && row.memberId !== null)
            .map((row) => row.memberId as string),
        );

        const toInsert: Array<{
          roomId: string;
          memberId: string;
          displayName: string;
          code: string;
          isSimulated: boolean;
        }> = [];

        for (const member of eligibleMembers) {
          if (activeMemberIds.has(member.id)) {
            continue;
          }
          const code = allocateUniqueCode(usedCodeStrings);
          toInsert.push({
            roomId,
            memberId: member.id,
            displayName: member.fullName,
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

    async listCandidates(roomId) {
      const rows = await db
        .select({
          id: candidates.id,
          roomId: candidates.roomId,
          displayName: candidates.displayName,
          photoUrl: candidates.photoUrl,
          memberPhotoUrl: members.photoUrl,
          isEligible: candidates.isEligible,
        })
        .from(candidates)
        .leftJoin(members, eq(candidates.memberId, members.id))
        .where(and(eq(candidates.roomId, roomId), eq(candidates.isEligible, true)))
        .orderBy(asc(candidates.displayName));
      return rows.map(toStoredCandidate);
    },

    async listAllCandidates(roomId) {
      const rows = await db
        .select({
          id: candidates.id,
          roomId: candidates.roomId,
          displayName: candidates.displayName,
          photoUrl: candidates.photoUrl,
          memberPhotoUrl: members.photoUrl,
          isEligible: candidates.isEligible,
        })
        .from(candidates)
        .leftJoin(members, eq(candidates.memberId, members.id))
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
          displayName: candidates.displayName,
          photoUrl: candidates.photoUrl,
          memberPhotoUrl: members.photoUrl,
          isEligible: candidates.isEligible,
        })
        .from(candidates)
        .leftJoin(members, eq(candidates.memberId, members.id))
        .where(and(inArray(candidates.roomId, roomIds), eq(candidates.isEligible, true)))
        .orderBy(asc(candidates.displayName));
      return rows.map(toStoredCandidate);
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

            await tx.insert(auditEvents).values({
              roomId,
              actorRole: "admin",
              action: "round_opened",
              payload: {
                roundId: row.id,
                roundNumber: row.number,
                ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
              },
            });

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

    async closeRound(roomId, roundId, outcome) {
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(rounds)
          .set({
            status: "closed",
            outcome,
            closedAt: new Date(),
          })
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId), eq(rounds.status, "open")))
          .returning();
        const row = updated[0];
        if (!row) {
          return null;
        }

        await tx.insert(auditEvents).values({
          roomId,
          actorRole: "admin",
          action: "round_closed",
          payload: {
            roundId: row.id,
            roundNumber: row.number,
            outcome: row.outcome,
            ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
          },
        });

        const restartCounts = await loadRestartCountsByRoom(tx, [roomId]);
        return toStoredRound(row, restartCounts.get(row.id) ?? 0);
      });
    },

    async restartRound(roomId, roundId) {
      return db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId), eq(rounds.status, "open")))
          .limit(1);
        const existing = existingRows[0];
        if (!existing) {
          return null;
        }

        if (existing.officeLabel === null) {
          const roomRoundRows = await tx
            .select({ id: rounds.id })
            .from(rounds)
            .where(eq(rounds.roomId, roomId));
          const roomRoundIds = roomRoundRows.map((item) => item.id);
          if (roomRoundIds.length > 0) {
            await tx.delete(ballots).where(inArray(ballots.roundId, roomRoundIds));
            await tx.delete(voteReceipts).where(inArray(voteReceipts.roundId, roomRoundIds));
          }
          await tx.delete(rounds).where(and(eq(rounds.roomId, roomId), ne(rounds.id, roundId)));
          await tx.update(candidates).set({ isEligible: true }).where(eq(candidates.roomId, roomId));
        } else {
          const officeRoundRows = await tx
            .select({ id: rounds.id })
            .from(rounds)
            .where(
              and(
                eq(rounds.roomId, roomId),
                eq(rounds.officeLabel, existing.officeLabel),
                or(isNull(rounds.outcome), ne(rounds.outcome, "declined")),
              ),
            );
          const officeRoundIds = officeRoundRows.map((item) => item.id);
          if (officeRoundIds.length > 0) {
            await tx.delete(ballots).where(inArray(ballots.roundId, officeRoundIds));
            await tx.delete(voteReceipts).where(inArray(voteReceipts.roundId, officeRoundIds));
          }
          await tx
            .delete(rounds)
            .where(
              and(
                eq(rounds.roomId, roomId),
                eq(rounds.officeLabel, existing.officeLabel),
                ne(rounds.id, roundId),
                or(isNull(rounds.outcome), ne(rounds.outcome, "declined")),
              ),
            );
        }

        const updated = await tx
          .update(rounds)
          .set({
            ...(existing.officeLabel === null ? { number: 1 } : {}),
            status: "open",
            outcome: null,
            closedAt: null,
            openedAt: new Date(),
          })
          .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId), eq(rounds.status, "open")))
          .returning();
        const row = updated[0];
        if (!row) {
          return null;
        }

        await tx.insert(auditEvents).values({
          roomId,
          actorRole: "admin",
          action: "round_restarted",
          payload: {
            roundId: row.id,
            roundNumber: row.number,
            ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
          },
        });

        const restartCounts = await loadRestartCountsByRoom(tx, [roomId]);
        return toStoredRound(row, restartCounts.get(row.id) ?? 1);
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

        await tx.insert(auditEvents).values({
          roomId,
          actorRole: "admin",
          action: "office_declined",
          payload: {
            roundId: row.id,
            roundNumber: row.number,
            declinedCandidateId,
            ...(row.officeLabel !== null ? { officeLabel: row.officeLabel } : {}),
          },
        });

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
          actorRole: auditEvents.actorRole,
          action: auditEvents.action,
          payload: auditEvents.payload,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .innerJoin(rooms, eq(auditEvents.roomId, rooms.id))
        .where(and(eq(auditEvents.roomId, roomId), eq(rooms.churchId, church.id)))
        .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
      return rows.map(toStoredAuditEvent);
    },

    async recordAuditEvent(roomId, action, payload = {}) {
      const room = await this.findRoomById(roomId);
      if (!room) {
        throw new Error("Cannot record audit event for unknown room");
      }
      const inserted = await insertAuditEvent(db, roomId, action, payload);
      return toStoredAuditEvent(inserted);
    },

    async castBallot(input) {
      return db.transaction(async (tx) => {
        const roundRows = await tx
          .select()
          .from(rounds)
          .where(and(eq(rounds.id, input.roundId), eq(rounds.roomId, input.roomId)))
          .limit(1);
        const round = roundRows[0];
        if (!round || round.status !== "open") {
          return { ok: false as const, reason: "round_not_open" as const };
        }

        const participant = await findParticipantByJoinKey(tx, input.roomId, input.joinKeyHash);
        if (!participant || !participant.isPresent) {
          return { ok: false as const, reason: "participant_not_present" as const };
        }

        if (participant.accessCodeId) {
          const codeRows = await tx
            .select({ revokedAt: roomMemberCodes.revokedAt })
            .from(roomMemberCodes)
            .where(eq(roomMemberCodes.id, participant.accessCodeId))
            .limit(1);
          if (!codeRows[0] || codeRows[0].revokedAt !== null) {
            return { ok: false as const, reason: "access_code_revoked" as const };
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
          roomStatus: "open",
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
          ballotToken: createBallotToken(),
        });

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
          .where(eq(members.churchId, churchId));
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
      return db.transaction(async (tx) => {
        const church = await findChurchByName(tx, churchName);
        if (!church) {
          return null;
        }
        const updated = await tx
          .update(members)
          .set({
            fullName: input.fullName,
            isCommunicant: input.isCommunicant,
            isMale: input.isMale,
            birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
            photoUrl: input.photoUrl ?? null,
            societyFlags: input.societyFlags ?? {},
            updatedAt: new Date(),
          })
          .where(and(eq(members.id, memberId), eq(members.churchId, church.id)))
          .returning();
        if (updated[0]) {
          await tx
            .update(candidates)
            .set({
              displayName: input.fullName,
              photoUrl: input.photoUrl ?? null,
            })
            .where(eq(candidates.memberId, memberId));
        }
        return updated[0] ? toStoredMember(updated[0]) : null;
      });
    },

    async deleteMember(memberId) {
      return db.transaction(async (tx) => {
        const church = await findChurchByName(tx, churchName);
        if (!church) {
          return false;
        }
        await tx
          .update(roomMemberCodes)
          .set({ memberId: null })
          .where(eq(roomMemberCodes.memberId, memberId));
        await tx
          .update(participants)
          .set({ memberId: null })
          .where(eq(participants.memberId, memberId));
        await tx
          .update(candidates)
          .set({ memberId: null })
          .where(eq(candidates.memberId, memberId));
        const deleted = await tx
          .delete(members)
          .where(and(eq(members.id, memberId), eq(members.churchId, church.id)))
          .returning({ id: members.id });
        return deleted.length > 0;
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
        .where(eq(members.churchId, church.id))
        .orderBy(asc(members.fullName));
      return rows.map(toStoredMember);
    },

    async sendReaction({ roomId, joinKeyHash, emoji, since, maxPerWindow }) {
      return db.transaction(async (tx) => {
        const [participant] = await tx
          .select()
          .from(participants)
          .where(and(eq(participants.roomId, roomId), eq(participants.joinKeyHash, joinKeyHash)))
          .for("update")
          .limit(1);

        if (!participant || !participant.isPresent) {
          return { ok: false, reason: "participant_not_in_room" } as const;
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
          .from(reactions)
          .where(
            and(
              eq(reactions.roomId, roomId),
              eq(reactions.participantId, participant.id),
              gte(reactions.createdAt, since),
            ),
          );

        if (isReactionRateLimited(recent?.total ?? 0, maxPerWindow)) {
          return { ok: false, reason: "rate_limited" } as const;
        }

        const [inserted] = await tx
          .insert(reactions)
          .values({
            roomId,
            participantId: participant.id,
            emoji,
          })
          .returning({ createdAt: reactions.createdAt });

        return {
          ok: true,
          emoji,
          createdAt: inserted?.createdAt ?? new Date(),
        } as const;
      });
    },
  };
}

function toStoredCandidate(row: {
  id: string;
  roomId: string;
  displayName: string;
  photoUrl?: string | null;
  memberPhotoUrl?: string | null;
  isEligible: boolean;
}): StoredCandidate {
  return {
    id: row.id,
    roomId: row.roomId,
    displayName: row.displayName,
    photoUrl: row.memberPhotoUrl ?? row.photoUrl ?? null,
    isEligible: row.isEligible,
  };
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

function toStoredRoom(row: {
  id: string;
  title: string;
  roomType: string;
  rulesPreset: RulesPreset;
  quorumValue: number;
  quorumUnit: QuorumUnit;
  eligibleCount: number;
  inviteToken: string;
  status: string;
  reactionsEnabled: boolean;
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
    inviteToken: row.inviteToken,
    status: row.status as RoomStatus,
    reactionsEnabled: row.reactionsEnabled,
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
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    ...(restartCount > 0 ? { restartCount } : {}),
  };
}

function toStoredAuditEvent(row: {
  id: string;
  roomId: string;
  actorRole: string;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}): StoredAuditEvent {
  return {
    id: row.id,
    roomId: row.roomId,
    actorRole: row.actorRole,
    action: row.action,
    payload: row.payload ?? {},
    createdAt: row.createdAt,
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
    .select({ payload: auditEvents.payload })
    .from(auditEvents)
    .where(and(inArray(auditEvents.roomId, roomIds), eq(auditEvents.action, "round_restarted")));

  for (const row of rows) {
    const roundId = row.payload?.roundId;
    if (typeof roundId === "string") {
      counts.set(roundId, (counts.get(roundId) ?? 0) + 1);
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
    memberId: row.memberId,
    displayName: row.displayName,
    code: row.code,
    isSimulated: row.isSimulated,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

async function insertAuditEvent(
  executor: Pick<Db, "insert">,
  roomId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const [inserted] = await executor
    .insert(auditEvents)
    .values({
      roomId,
      actorRole: "admin",
      action,
      payload,
    })
    .returning();
  if (!inserted) {
    throw new Error("Audit event insert returned no row");
  }
  return inserted;
}
