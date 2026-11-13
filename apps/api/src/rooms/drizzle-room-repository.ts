import { participants, rooms, type Db } from "@scelta/db";
import type { QuorumUnit, RoomStatus, RoomType, RulesPreset } from "@scelta/domain";
import { and, count, desc, eq } from "drizzle-orm";
import { findChurchByName, getOrCreateChurch, isUniqueViolation } from "../churches/church-store.js";
import { createInviteToken } from "./invite-token.js";
import type { JoinedParticipant, RoomRepository, StoredRoom } from "./room-repository.js";

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
              inviteToken,
              status: room.status,
            })
            .returning();

          const row = inserted[0];
          if (!row) {
            throw new Error("Room insert returned no row");
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
  };
}

async function findParticipantByJoinKey(db: Db, roomId: string, joinKeyHash: string) {
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
    inviteToken: row.inviteToken,
    status: row.status as RoomStatus,
    createdAt: row.createdAt,
  };
}
