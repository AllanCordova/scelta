import {
  participants,
  roomEntryRequests,
  roomRoster,
  rooms,
  type Db,
} from "@scelta/db";
import {
  canEnterRoom,
  canJoinRoom,
  matchesRosterSearch,
  resolveRoomMaxParticipants,
  verifyBirthDayMonth,
  type EntryRequestStatus,
} from "@scelta/domain";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { findChurchByName } from "../churches/church-store.js";
import type {
  ApprovalQueueSnapshot,
  ApproveAllEntryRequestsResult,
  ApproveEntryRequestResult,
  ClaimedParticipantSummary,
  DisputedEntrySummary,
  EntryRequestStatusResult,
  RejectEntryRequestResult,
  ReleaseClaimedNameResult,
  RosterSearchEntry,
  StoredEntryRequest,
  SubmitEntryRequestInput,
  SubmitEntryRequestResult,
} from "./room-repository.js";

const ROSTER_SEARCH_MAX_RESULTS = 20;

type DbExecutor = Pick<Db, "insert" | "select" | "update">;

export type AuditEventInserter = (
  executor: Pick<Db, "insert" | "select">,
  roomId: string,
  action: string,
  payload: Record<string, unknown>,
  meta?: {
    churchId?: string | null;
    roomTitle?: string | null;
    actorRole?: string;
  },
) => Promise<unknown>;

export type ApprovalEntryStoreDeps = {
  db: Db;
  churchName: string;
  insertAuditEvent: AuditEventInserter;
};

export async function countRoomTotalPresent(
  executor: Pick<Db, "select">,
  roomId: string,
): Promise<{ onlinePresentCount: number; paperVotersCount: number; totalPresent: number }> {
  const [onlineRows, paperRows] = await Promise.all([
    executor
      .select({ value: count() })
      .from(participants)
      .where(and(eq(participants.roomId, roomId), eq(participants.isPresent, true))),
    executor
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

  const onlinePresentCount = Number(onlineRows[0]?.value ?? 0);
  const paperVotersCount = Number(paperRows[0]?.value ?? 0);
  return {
    onlinePresentCount,
    paperVotersCount,
    totalPresent: onlinePresentCount + paperVotersCount,
  };
}

export function createApprovalEntryStore(deps: ApprovalEntryStoreDeps) {
  const { db, churchName, insertAuditEvent } = deps;

  return {
    async searchRoomRoster(roomId: string, query: string): Promise<RosterSearchEntry[]> {
      const [rosterRows, pendingRows, claimedParticipantRows] = await Promise.all([
        db
          .select({
            id: roomRoster.id,
            memberId: roomRoster.memberId,
            fullName: roomRoster.fullName,
            birthDate: roomRoster.birthDate,
          })
          .from(roomRoster)
          .where(
            and(
              eq(roomRoster.roomId, roomId),
              isNull(roomRoster.removedAt),
              eq(roomRoster.isEligibleVoter, true),
              eq(roomRoster.votesOnPaper, false),
            ),
          )
          .orderBy(asc(roomRoster.fullName), asc(roomRoster.createdAt)),
        db
          .select({ rosterEntryId: roomEntryRequests.rosterEntryId })
          .from(roomEntryRequests)
          .where(
            and(
              eq(roomEntryRequests.roomId, roomId),
              eq(roomEntryRequests.status, "pending"),
            ),
          ),
        db
          .select({
            rosterEntryId: participants.rosterEntryId,
            memberId: participants.memberId,
          })
          .from(participants)
          .where(
            and(
              eq(participants.roomId, roomId),
              or(eq(participants.isPresent, true), isNotNull(participants.joinKeyHash)),
            ),
          ),
      ]);

      const claimedRosterIds = new Set<string>(pendingRows.map((row) => row.rosterEntryId));
      const claimedMemberIds = new Set<string>();
      for (const participant of claimedParticipantRows) {
        if (participant.rosterEntryId) {
          claimedRosterIds.add(participant.rosterEntryId);
        }
        if (participant.memberId) {
          claimedMemberIds.add(participant.memberId);
        }
      }

      const matched = rosterRows
        .filter((entry) => matchesRosterSearch(entry.fullName, query))
        .slice(0, ROSTER_SEARCH_MAX_RESULTS);

      return matched.map((entry) => ({
        rosterEntryId: entry.id,
        fullName: entry.fullName,
        requiresBirthDate: entry.birthDate !== null,
        isClaimed:
          claimedRosterIds.has(entry.id) ||
          (entry.memberId !== null && claimedMemberIds.has(entry.memberId)),
      }));
    },

    async submitEntryRequest(input: SubmitEntryRequestInput): Promise<SubmitEntryRequestResult> {
      return db.transaction(async (tx) => {
        const [room] = await tx
          .select({
            id: rooms.id,
            title: rooms.title,
            churchId: rooms.churchId,
            status: rooms.status,
            entryMode: rooms.entryMode,
            entryOpen: rooms.entryOpen,
            maxParticipants: rooms.maxParticipants,
            eligibleCount: rooms.eligibleCount,
          })
          .from(rooms)
          .where(eq(rooms.id, input.roomId))
          .for("update")
          .limit(1);

        if (!room) {
          return { ok: false as const, reason: "room_not_found" as const };
        }
        if (!canJoinRoom(room.status)) {
          return { ok: false as const, reason: "room_not_joinable" as const };
        }
        if (room.entryMode !== "aprovacao") {
          return { ok: false as const, reason: "approval_mode_required" as const };
        }

        const [entry] = await tx
          .select({
            id: roomRoster.id,
            memberId: roomRoster.memberId,
            fullName: roomRoster.fullName,
            birthDate: roomRoster.birthDate,
            isEligibleVoter: roomRoster.isEligibleVoter,
            votesOnPaper: roomRoster.votesOnPaper,
          })
          .from(roomRoster)
          .where(
            and(
              eq(roomRoster.id, input.rosterEntryId),
              eq(roomRoster.roomId, room.id),
              isNull(roomRoster.removedAt),
            ),
          )
          .limit(1);

        if (!entry || !entry.isEligibleVoter) {
          return { ok: false as const, reason: "roster_entry_not_found" as const };
        }
        if (entry.votesOnPaper) {
          return { ok: false as const, reason: "voter_on_paper" as const };
        }

        const existingParticipant = await findParticipantForRosterEntry(tx, room.id, entry);

        // Same browser already approved and present can re-enter even if entry is closed or full.
        if (
          existingParticipant &&
          existingParticipant.joinKeyHash === input.joinKeyHash &&
          existingParticipant.isPresent
        ) {
          return {
            ok: true as const,
            status: "approved" as const,
            requestId: null,
            displayName: existingParticipant.displayName,
            created: false,
          };
        }

        const [pendingRequest] = await tx
          .select()
          .from(roomEntryRequests)
          .where(
            and(
              eq(roomEntryRequests.roomId, room.id),
              eq(roomEntryRequests.rosterEntryId, entry.id),
              eq(roomEntryRequests.status, "pending"),
            ),
          )
          .for("update")
          .limit(1);

        if (pendingRequest && pendingRequest.joinKeyHash === input.joinKeyHash) {
          return {
            ok: true as const,
            status: "pending" as const,
            requestId: pendingRequest.id,
            displayName: pendingRequest.displayName,
            created: false,
          };
        }

        if (!room.entryOpen) {
          return { ok: false as const, reason: "entry_closed" as const };
        }

        const [existingSessionHolder] = await tx
          .select({ id: participants.id })
          .from(participants)
          .where(
            and(
              eq(participants.roomId, room.id),
              eq(participants.joinKeyHash, input.joinKeyHash),
            ),
          )
          .limit(1);
        if (existingSessionHolder && existingSessionHolder.id !== existingParticipant?.id) {
          return { ok: false as const, reason: "session_already_in_use" as const };
        }

        const birthCheck = verifyBirthDayMonth(entry.birthDate, {
          birthDay: input.birthDay,
          birthMonth: input.birthMonth,
        });
        if (!birthCheck.ok) {
          return { ok: false as const, reason: birthCheck.reason };
        }

        const isPendingByOther = Boolean(
          pendingRequest && pendingRequest.joinKeyHash !== input.joinKeyHash,
        );
        const isClaimedParticipantByOther = Boolean(
          existingParticipant &&
            (existingParticipant.isPresent || existingParticipant.joinKeyHash !== null) &&
            existingParticipant.joinKeyHash !== input.joinKeyHash,
        );

        if (isPendingByOther || isClaimedParticipantByOther) {
          const now = new Date();
          if (pendingRequest) {
            await tx
              .update(roomEntryRequests)
              .set({
                disputedAttemptCount: pendingRequest.disputedAttemptCount + 1,
                lastDisputedAt: now,
              })
              .where(eq(roomEntryRequests.id, pendingRequest.id));
          } else {
            const [latestApproved] = await tx
              .select()
              .from(roomEntryRequests)
              .where(
                and(
                  eq(roomEntryRequests.roomId, room.id),
                  eq(roomEntryRequests.rosterEntryId, entry.id),
                  eq(roomEntryRequests.status, "approved"),
                ),
              )
              .orderBy(desc(roomEntryRequests.decidedAt), desc(roomEntryRequests.createdAt))
              .for("update")
              .limit(1);

            if (latestApproved) {
              await tx
                .update(roomEntryRequests)
                .set({
                  disputedAttemptCount: latestApproved.disputedAttemptCount + 1,
                  lastDisputedAt: now,
                })
                .where(eq(roomEntryRequests.id, latestApproved.id));
            } else if (existingParticipant) {
              // Edge case: participant entered under another mode before switching to approval mode.
              await tx.insert(roomEntryRequests).values({
                roomId: room.id,
                rosterEntryId: entry.id,
                displayName: entry.fullName,
                joinKeyHash: existingParticipant.joinKeyHash ?? "legacy-claim",
                status: "approved",
                disputedAttemptCount: 1,
                lastDisputedAt: now,
                decidedAt: existingParticipant.joinedAt,
              });
            }
          }

          await insertAuditEvent(
            tx,
            room.id,
            "entry_request_disputed",
            {
              rosterEntryId: entry.id,
              displayName: entry.fullName,
              holderStatus: isPendingByOther ? "pending" : "approved",
              sessionFingerprint: input.joinKeyHash.slice(0, 12),
            },
            {
              churchId: room.churchId,
              roomTitle: room.title,
              actorRole: "voter",
            },
          );

          return { ok: false as const, reason: "roster_name_already_claimed" as const };
        }

        const { totalPresent } = await countRoomTotalPresent(tx, room.id);
        const entryCheck = canEnterRoom({
          status: room.status,
          entryOpen: room.entryOpen,
          presentCount: totalPresent,
          maxParticipants: room.maxParticipants,
          eligibleCount: room.eligibleCount,
          isReentry: false,
        });
        if (!entryCheck.allowed) {
          if (entryCheck.reason === "room_full") {
            return { ok: false as const, reason: "room_capacity_reached" as const };
          }
          if (entryCheck.reason === "entry_closed") {
            return { ok: false as const, reason: "entry_closed" as const };
          }
          return { ok: false as const, reason: "room_not_joinable" as const };
        }

        // Cancel any previous pending request from the same device for another roster name.
        await tx
          .update(roomEntryRequests)
          .set({ status: "cancelled", decidedAt: new Date() })
          .where(
            and(
              eq(roomEntryRequests.roomId, room.id),
              eq(roomEntryRequests.joinKeyHash, input.joinKeyHash),
              eq(roomEntryRequests.status, "pending"),
            ),
          );

        const [inserted] = await tx
          .insert(roomEntryRequests)
          .values({
            roomId: room.id,
            rosterEntryId: entry.id,
            displayName: entry.fullName,
            joinKeyHash: input.joinKeyHash,
            status: "pending",
          })
          .returning();

        if (!inserted) {
          throw new Error("Entry request insert returned no row");
        }

        await insertAuditEvent(
          tx,
          room.id,
          "entry_request_created",
          {
            requestId: inserted.id,
            rosterEntryId: entry.id,
            displayName: entry.fullName,
            sessionFingerprint: input.joinKeyHash.slice(0, 12),
          },
          {
            churchId: room.churchId,
            roomTitle: room.title,
            actorRole: "voter",
          },
        );

        return {
          ok: true as const,
          status: "pending" as const,
          requestId: inserted.id,
          displayName: inserted.displayName,
          created: true,
        };
      });
    },

    async getEntryRequestStatus(
      roomId: string,
      requestId: string,
      joinKeyHash: string,
    ): Promise<EntryRequestStatusResult> {
      const [row] = await db
        .select({
          id: roomEntryRequests.id,
          status: roomEntryRequests.status,
          displayName: roomEntryRequests.displayName,
          joinKeyHash: roomEntryRequests.joinKeyHash,
        })
        .from(roomEntryRequests)
        .where(and(eq(roomEntryRequests.id, requestId), eq(roomEntryRequests.roomId, roomId)))
        .limit(1);

      if (!row) {
        return { ok: false as const, reason: "request_not_found" as const };
      }
      if (row.joinKeyHash !== joinKeyHash) {
        return { ok: false as const, reason: "forbidden_entry_request" as const };
      }

      return {
        ok: true as const,
        requestId: row.id,
        status: row.status as EntryRequestStatus,
        displayName: row.displayName,
      };
    },

    async listEntryRequests(roomId: string): Promise<ApprovalQueueSnapshot | null> {
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

      const [requestRows, participantRows] = await Promise.all([
        db
          .select()
          .from(roomEntryRequests)
          .where(
            and(
              eq(roomEntryRequests.roomId, roomId),
              inArray(roomEntryRequests.status, ["pending", "approved"]),
            ),
          )
          .orderBy(asc(roomEntryRequests.createdAt)),
        db
          .select({
            id: participants.id,
            rosterEntryId: participants.rosterEntryId,
            displayName: participants.displayName,
            isPresent: participants.isPresent,
            joinedAt: participants.joinedAt,
          })
          .from(participants)
          .where(
            and(
              eq(participants.roomId, roomId),
              or(eq(participants.isPresent, true), isNotNull(participants.joinKeyHash)),
            ),
          )
          .orderBy(asc(participants.joinedAt)),
      ]);

      const requests = requestRows.map(toStoredEntryRequest);
      const latestApprovedByRoster = new Map<string, StoredEntryRequest>();
      for (const req of requests) {
        if (req.status === "approved") {
          latestApprovedByRoster.set(req.rosterEntryId, req);
        }
      }

      const claimedParticipants: ClaimedParticipantSummary[] = participantRows.map((p) => {
        const approvedReq = p.rosterEntryId ? latestApprovedByRoster.get(p.rosterEntryId) : undefined;
        return {
          participantId: p.id,
          rosterEntryId: p.rosterEntryId,
          displayName: p.displayName,
          isPresent: p.isPresent,
          joinedAt: p.joinedAt,
          disputedAttemptCount: approvedReq?.disputedAttemptCount ?? 0,
          lastDisputedAt: approvedReq?.lastDisputedAt ?? null,
        };
      });

      const participantByRoster = new Map<string, ClaimedParticipantSummary>();
      for (const p of claimedParticipants) {
        if (p.rosterEntryId) {
          participantByRoster.set(p.rosterEntryId, p);
        }
      }

      const disputesByRoster = new Map<string, DisputedEntrySummary>();
      for (const req of requests) {
        if (req.disputedAttemptCount <= 0) {
          continue;
        }
        if (req.status === "pending") {
          disputesByRoster.set(req.rosterEntryId, {
            rosterEntryId: req.rosterEntryId,
            displayName: req.displayName,
            disputedAttemptCount: req.disputedAttemptCount,
            lastDisputedAt: req.lastDisputedAt ?? req.createdAt,
            currentHolderStatus: "pending",
            requestId: req.id,
            participantId: null,
          });
        } else if (req.status === "approved") {
          const holder = participantByRoster.get(req.rosterEntryId);
          if (holder) {
            disputesByRoster.set(req.rosterEntryId, {
              rosterEntryId: req.rosterEntryId,
              displayName: holder.displayName,
              disputedAttemptCount: req.disputedAttemptCount,
              lastDisputedAt: req.lastDisputedAt ?? req.createdAt,
              currentHolderStatus: "approved",
              requestId: req.id,
              participantId: holder.participantId,
            });
          }
        }
      }

      return {
        requests,
        claimedParticipants,
        disputes: Array.from(disputesByRoster.values()),
      };
    },

    async approveEntryRequest(
      roomId: string,
      requestId: string,
      actorAdminId: string,
    ): Promise<ApproveEntryRequestResult> {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [room] = await tx
          .select({
            id: rooms.id,
            title: rooms.title,
            churchId: rooms.churchId,
            status: rooms.status,
            maxParticipants: rooms.maxParticipants,
            eligibleCount: rooms.eligibleCount,
          })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);

        if (!room) {
          return { ok: false as const, reason: "room_not_found" as const };
        }
        if (!canJoinRoom(room.status)) {
          return { ok: false as const, reason: "room_not_joinable" as const };
        }

        const [reqRow] = await tx
          .select()
          .from(roomEntryRequests)
          .where(and(eq(roomEntryRequests.id, requestId), eq(roomEntryRequests.roomId, room.id)))
          .for("update")
          .limit(1);

        if (!reqRow) {
          return { ok: false as const, reason: "request_not_found" as const };
        }
        if (reqRow.status !== "pending") {
          return { ok: false as const, reason: "request_not_pending" as const };
        }

        const maxLimit = resolveRoomMaxParticipants({
          maxParticipants: room.maxParticipants,
          eligibleCount: room.eligibleCount,
        });
        const { totalPresent } = await countRoomTotalPresent(tx, room.id);
        if (maxLimit > 0 && totalPresent >= maxLimit) {
          return { ok: false as const, reason: "room_capacity_reached" as const };
        }

        const result = await approveLockedPendingRequest(
          tx,
          room,
          reqRow,
          actorAdminId,
          insertAuditEvent,
        );
        return result;
      });
    },

    async approveAllEntryRequests(
      roomId: string,
      actorAdminId: string,
    ): Promise<ApproveAllEntryRequestsResult> {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [room] = await tx
          .select({
            id: rooms.id,
            title: rooms.title,
            churchId: rooms.churchId,
            status: rooms.status,
            maxParticipants: rooms.maxParticipants,
            eligibleCount: rooms.eligibleCount,
          })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);

        if (!room) {
          return { ok: false as const, reason: "room_not_found" as const };
        }
        if (!canJoinRoom(room.status)) {
          return { ok: false as const, reason: "room_not_joinable" as const };
        }

        const pendingRows = await tx
          .select()
          .from(roomEntryRequests)
          .where(
            and(
              eq(roomEntryRequests.roomId, room.id),
              eq(roomEntryRequests.status, "pending"),
            ),
          )
          .orderBy(asc(roomEntryRequests.createdAt))
          .for("update");

        if (pendingRows.length === 0) {
          return { ok: true as const, approvedCount: 0, skippedCount: 0 };
        }

        const maxLimit = resolveRoomMaxParticipants({
          maxParticipants: room.maxParticipants,
          eligibleCount: room.eligibleCount,
        });
        let { totalPresent } = await countRoomTotalPresent(tx, room.id);

        if (maxLimit > 0 && totalPresent >= maxLimit) {
          return { ok: false as const, reason: "room_capacity_reached" as const };
        }

        let approvedCount = 0;
        let skippedCount = 0;

        for (const pending of pendingRows) {
          if (maxLimit > 0 && totalPresent >= maxLimit) {
            skippedCount += 1;
            continue;
          }

          const approved = await approveLockedPendingRequest(
            tx,
            room,
            pending,
            actorAdminId,
            insertAuditEvent,
          );
          if (approved.ok) {
            approvedCount += 1;
            totalPresent += 1;
          } else {
            skippedCount += 1;
          }
        }

        return { ok: true as const, approvedCount, skippedCount };
      });
    },

    async rejectEntryRequest(
      roomId: string,
      requestId: string,
      actorAdminId: string,
    ): Promise<RejectEntryRequestResult> {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [room] = await tx
          .select({ id: rooms.id, title: rooms.title, churchId: rooms.churchId })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .limit(1);
        if (!room) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        const [reqRow] = await tx
          .select()
          .from(roomEntryRequests)
          .where(and(eq(roomEntryRequests.id, requestId), eq(roomEntryRequests.roomId, room.id)))
          .for("update")
          .limit(1);

        if (!reqRow) {
          return { ok: false as const, reason: "request_not_found" as const };
        }
        if (reqRow.status !== "pending") {
          return { ok: false as const, reason: "request_not_pending" as const };
        }

        const now = new Date();
        const [updated] = await tx
          .update(roomEntryRequests)
          .set({
            status: "rejected",
            decidedByAdminId: actorAdminId,
            decidedAt: now,
          })
          .where(eq(roomEntryRequests.id, reqRow.id))
          .returning();
        if (!updated) {
          throw new Error("Entry request reject update returned no row");
        }

        await insertAuditEvent(
          tx,
          room.id,
          "entry_request_rejected",
          {
            requestId: updated.id,
            rosterEntryId: updated.rosterEntryId,
            displayName: updated.displayName,
            actorAdminId,
          },
          {
            churchId: room.churchId,
            roomTitle: room.title,
            actorRole: "admin",
          },
        );

        return { ok: true as const, request: toStoredEntryRequest(updated) };
      });
    },

    async releaseClaimedName(
      roomId: string,
      target: { rosterEntryId?: string; participantId?: string },
      actorAdminId: string,
    ): Promise<ReleaseClaimedNameResult> {
      const church = await findChurchByName(db, churchName);
      if (!church) {
        return { ok: false as const, reason: "room_not_found" as const };
      }

      return db.transaction(async (tx) => {
        const [room] = await tx
          .select({ id: rooms.id, title: rooms.title, churchId: rooms.churchId })
          .from(rooms)
          .where(and(eq(rooms.id, roomId), eq(rooms.churchId, church.id)))
          .for("update")
          .limit(1);
        if (!room) {
          return { ok: false as const, reason: "room_not_found" as const };
        }

        let resolvedParticipant:
          | {
              id: string;
              rosterEntryId: string | null;
              displayName: string;
            }
          | null = null;
        let resolvedRosterEntryId: string | null = target.rosterEntryId ?? null;
        let resolvedDisplayName: string | null = null;

        if (target.participantId) {
          const [participantRow] = await tx
            .select({
              id: participants.id,
              rosterEntryId: participants.rosterEntryId,
              displayName: participants.displayName,
            })
            .from(participants)
            .where(and(eq(participants.id, target.participantId), eq(participants.roomId, room.id)))
            .for("update")
            .limit(1);
          if (participantRow) {
            resolvedParticipant = participantRow;
            resolvedRosterEntryId = resolvedRosterEntryId ?? participantRow.rosterEntryId;
            resolvedDisplayName = participantRow.displayName;
          }
        }

        if (resolvedRosterEntryId) {
          const [rosterEntry] = await tx
            .select({
              id: roomRoster.id,
              memberId: roomRoster.memberId,
              fullName: roomRoster.fullName,
            })
            .from(roomRoster)
            .where(and(eq(roomRoster.id, resolvedRosterEntryId), eq(roomRoster.roomId, room.id)))
            .limit(1);

          if (rosterEntry) {
            resolvedDisplayName = resolvedDisplayName ?? rosterEntry.fullName;
            if (!resolvedParticipant) {
              const found = await findParticipantForRosterEntry(tx, room.id, rosterEntry);
              if (found) {
                resolvedParticipant = {
                  id: found.id,
                  rosterEntryId: found.rosterEntryId,
                  displayName: found.displayName,
                };
              }
            }
          }
        }

        const now = new Date();
        let cancelledRequestCount = 0;

        if (resolvedParticipant) {
          await tx
            .update(participants)
            .set({ isPresent: false, joinKeyHash: null })
            .where(eq(participants.id, resolvedParticipant.id));
        }

        if (resolvedRosterEntryId) {
          const cancelled = await tx
            .update(roomEntryRequests)
            .set({
              status: "cancelled",
              disputedAttemptCount: 0,
              decidedByAdminId: actorAdminId,
              decidedAt: now,
            })
            .where(
              and(
                eq(roomEntryRequests.roomId, room.id),
                eq(roomEntryRequests.rosterEntryId, resolvedRosterEntryId),
                inArray(roomEntryRequests.status, ["pending", "approved"]),
              ),
            )
            .returning({ id: roomEntryRequests.id, displayName: roomEntryRequests.displayName });

          cancelledRequestCount = cancelled.length;
          if (!resolvedDisplayName && cancelled[0]) {
            resolvedDisplayName = cancelled[0].displayName;
          }
        }

        if (!resolvedParticipant && cancelledRequestCount === 0) {
          return { ok: false as const, reason: "target_not_found" as const };
        }

        const displayName = resolvedDisplayName ?? "Participante";
        await insertAuditEvent(
          tx,
          room.id,
          "roster_name_released",
          {
            rosterEntryId: resolvedRosterEntryId,
            participantId: resolvedParticipant?.id ?? null,
            displayName,
            actorAdminId,
          },
          {
            churchId: room.churchId,
            roomTitle: room.title,
            actorRole: "admin",
          },
        );

        return {
          ok: true as const,
          rosterEntryId: resolvedRosterEntryId,
          participantId: resolvedParticipant?.id ?? null,
          displayName,
        };
      });
    },
  };
}

async function approveLockedPendingRequest(
  tx: DbExecutor,
  room: { id: string; title: string; churchId: string; status: string },
  reqRow: typeof roomEntryRequests.$inferSelect,
  actorAdminId: string,
  insertAuditEvent: AuditEventInserter,
): Promise<ApproveEntryRequestResult> {
  const [entry] = await tx
    .select({
      id: roomRoster.id,
      memberId: roomRoster.memberId,
      fullName: roomRoster.fullName,
      isEligibleVoter: roomRoster.isEligibleVoter,
      votesOnPaper: roomRoster.votesOnPaper,
    })
    .from(roomRoster)
    .where(
      and(
        eq(roomRoster.id, reqRow.rosterEntryId),
        eq(roomRoster.roomId, room.id),
        isNull(roomRoster.removedAt),
      ),
    )
    .limit(1);

  if (!entry || !entry.isEligibleVoter) {
    return { ok: false as const, reason: "roster_entry_not_found" as const };
  }
  if (entry.votesOnPaper) {
    return { ok: false as const, reason: "voter_on_paper" as const };
  }

  const existingParticipant = await findParticipantForRosterEntry(tx, room.id, entry);
  const [existingByJoinKey] = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.roomId, room.id),
        eq(participants.joinKeyHash, reqRow.joinKeyHash),
      ),
    )
    .limit(1);

  if (existingByJoinKey && existingByJoinKey.id !== existingParticipant?.id) {
    return { ok: false as const, reason: "session_already_in_use" as const };
  }

  let participantId: string;
  if (existingParticipant) {
    const [updatedParticipant] = await tx
      .update(participants)
      .set({
        rosterEntryId: entry.id,
        memberId: entry.memberId,
        displayName: entry.fullName,
        joinKeyHash: reqRow.joinKeyHash,
        isPresent: true,
      })
      .where(eq(participants.id, existingParticipant.id))
      .returning({ id: participants.id });
    participantId = updatedParticipant?.id ?? existingParticipant.id;
  } else {
    const [insertedParticipant] = await tx
      .insert(participants)
      .values({
        roomId: room.id,
        rosterEntryId: entry.id,
        memberId: entry.memberId,
        accessCodeId: null,
        displayName: entry.fullName,
        joinKeyHash: reqRow.joinKeyHash,
        isPresent: true,
      })
      .returning({ id: participants.id });
    if (!insertedParticipant) {
      throw new Error("Approved participant insert returned no row");
    }
    participantId = insertedParticipant.id;
  }

  const now = new Date();
  const [updatedRequest] = await tx
    .update(roomEntryRequests)
    .set({
      status: "approved",
      decidedByAdminId: actorAdminId,
      decidedAt: now,
    })
    .where(eq(roomEntryRequests.id, reqRow.id))
    .returning();
  if (!updatedRequest) {
    throw new Error("Entry request approve update returned no row");
  }

  await insertAuditEvent(
    tx,
    room.id,
    "entry_request_approved",
    {
      requestId: updatedRequest.id,
      rosterEntryId: entry.id,
      displayName: entry.fullName,
      actorAdminId,
    },
    {
      churchId: room.churchId,
      roomTitle: room.title,
      actorRole: "admin",
    },
  );

  await insertAuditEvent(
    tx,
    room.id,
    "participant_joined",
    {
      roomStatus: room.status,
      voterOrigin: "desk_approval",
      isSimulated: false,
      memberVerified: entry.memberId !== null,
      rosterEntryId: entry.id,
      sessionFingerprint: reqRow.joinKeyHash.slice(0, 12),
      alreadyJoined: false,
      adminIntervention: true,
    },
    {
      churchId: room.churchId,
      roomTitle: room.title,
      actorRole: "voter",
    },
  );

  return {
    ok: true as const,
    request: toStoredEntryRequest(updatedRequest),
    participantId,
  };
}

async function findParticipantForRosterEntry(
  tx: Pick<Db, "select">,
  roomId: string,
  entry: { id: string; memberId: string | null },
) {
  const matchers = [eq(participants.rosterEntryId, entry.id)];
  if (entry.memberId !== null) {
    matchers.push(eq(participants.memberId, entry.memberId));
  }
  const rows = await tx
    .select()
    .from(participants)
    .where(and(eq(participants.roomId, roomId), or(...matchers)))
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

function toStoredEntryRequest(row: typeof roomEntryRequests.$inferSelect): StoredEntryRequest {
  return {
    id: row.id,
    roomId: row.roomId,
    rosterEntryId: row.rosterEntryId,
    displayName: row.displayName,
    status: row.status as EntryRequestStatus,
    disputedAttemptCount: row.disputedAttemptCount,
    lastDisputedAt: row.lastDisputedAt ?? null,
    decidedByAdminId: row.decidedByAdminId ?? null,
    decidedAt: row.decidedAt ?? null,
    createdAt: row.createdAt,
  };
}
