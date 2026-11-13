import {
  ballots,
  candidates,
  participants,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import {
  canCastBallot,
  ROUND_RESULTS,
  type QuorumUnit,
  type RoomStatus,
  type RoomType,
  type RoundResult,
  type RulesPreset,
} from "@scelta/domain";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { findChurchByName, getOrCreateChurch, isUniqueViolation } from "../churches/church-store.js";
import { createBallotToken } from "./ballot-token.js";
import { createInviteToken } from "./invite-token.js";
import type {
  JoinedParticipant,
  RoomRepository,
  StoredCandidate,
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
          const inserted = await db
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
            await db.insert(candidates).values(
              room.candidates.map((displayName) => ({
                roomId: row.id,
                displayName,
                isEligible: true,
              })),
            );
          }

          return toStoredRoom(row);
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

    async joinRoom(roomId, displayName, joinKeyHash) {
      const existing = await findParticipantByJoinKey(db, roomId, joinKeyHash);
      if (existing) {
        return restorePresence(db, existing);
      }

      try {
        const inserted = await db
          .insert(participants)
          .values({
            roomId,
            displayName,
            joinKeyHash,
            isPresent: true,
          })
          .returning();
        const row = inserted[0];
        if (!row) {
          throw new Error("Participant insert returned no row");
        }
        return {
          id: row.id,
          roomId: row.roomId,
          displayName: row.displayName,
          alreadyJoined: false,
        };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        const raced = await findParticipantByJoinKey(db, roomId, joinKeyHash);
        if (!raced) {
          throw error;
        }
        return restorePresence(db, raced);
      }
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
        .select()
        .from(candidates)
        .where(and(eq(candidates.roomId, roomId), eq(candidates.isEligible, true)))
        .orderBy(asc(candidates.displayName));
      return rows.map(toStoredCandidate);
    },

    async listCandidatesByRooms(roomIds) {
      if (roomIds.length === 0) {
        return [];
      }

      const rows = await db
        .select()
        .from(candidates)
        .where(and(inArray(candidates.roomId, roomIds), eq(candidates.isEligible, true)))
        .orderBy(asc(candidates.displayName));
      return rows.map(toStoredCandidate);
    },

    async openRound(roomId) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const existing = await db.select().from(rounds).where(eq(rounds.roomId, roomId));
        if (existing.some((row) => row.status === "open")) {
          return { ok: false, reason: "round_already_open" };
        }

        const number = existing.reduce((max, row) => Math.max(max, row.number), 0) + 1;
        try {
          const inserted = await db
            .insert(rounds)
            .values({
              roomId,
              number,
              status: "open",
              openedAt: new Date(),
            })
            .returning();
          const row = inserted[0];
          if (!row) {
            throw new Error("Round insert returned no row");
          }
          return { ok: true, round: toStoredRound(row) };
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
        }
      }

      return { ok: false, reason: "round_already_open" };
    },

    async closeRound(roomId, roundId, outcome) {
      const updated = await db
        .update(rounds)
        .set({
          status: "closed",
          outcome,
          closedAt: new Date(),
        })
        .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId), eq(rounds.status, "open")))
        .returning();
      const row = updated[0];
      return row ? toStoredRound(row) : null;
    },

    async findRound(roomId, roundId) {
      const rows = await db
        .select()
        .from(rounds)
        .where(and(eq(rounds.id, roundId), eq(rounds.roomId, roomId)))
        .limit(1);
      const row = rows[0];
      return row ? toStoredRound(row) : null;
    },

    async latestRounds(roomIds) {
      if (roomIds.length === 0) {
        return [];
      }

      const rows = await db
        .select()
        .from(rounds)
        .where(inArray(rounds.roomId, roomIds))
        .orderBy(desc(rounds.number));
      const seen = new Set<string>();
      const latest: StoredRound[] = [];
      for (const row of rows) {
        if (seen.has(row.roomId)) {
          continue;
        }
        seen.add(row.roomId);
        latest.push(toStoredRound(row));
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
      return row ? toStoredRound(row) : null;
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

        const eligibility = canCastBallot({
          roomStatus: "open",
          roundStatus: round.status,
          isParticipantPresent: Boolean(participant?.isPresent),
          hasAlreadyVoted: false,
          isCandidateEligible: Boolean(candidateRows[0]),
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
  };
}

function toStoredCandidate(row: {
  id: string;
  roomId: string;
  displayName: string;
  isEligible: boolean;
}): StoredCandidate {
  return {
    id: row.id,
    roomId: row.roomId,
    displayName: row.displayName,
    isEligible: row.isEligible,
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

async function restorePresence(
  db: Db,
  participant: { id: string; roomId: string; displayName: string; isPresent: boolean },
): Promise<JoinedParticipant> {
  if (!participant.isPresent) {
    await db.update(participants).set({ isPresent: true }).where(eq(participants.id, participant.id));
  }

  return {
    id: participant.id,
    roomId: participant.roomId,
    displayName: participant.displayName,
    alreadyJoined: true,
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
  inviteToken: string;
  status: string;
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
    createdAt: row.createdAt,
  };
}

function toStoredRound(row: {
  id: string;
  roomId: string;
  number: number;
  status: StoredRoundStatus;
  outcome: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
}): StoredRound {
  return {
    id: row.id,
    roomId: row.roomId,
    number: row.number,
    status: row.status,
    outcome: toRoundResult(row.outcome),
    openedAt: row.openedAt,
    closedAt: row.closedAt,
  };
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
