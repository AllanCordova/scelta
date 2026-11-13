import { rooms, type Db } from "@scelta/db";
import type { CreateRoomStatus, QuorumUnit, RoomType, RulesPreset } from "@scelta/domain";
import { desc, eq } from "drizzle-orm";
import { findChurchByName, getOrCreateChurch, isUniqueViolation } from "../churches/church-store.js";
import { createInviteToken } from "./invite-token.js";
import type { RoomRepository, StoredRoom } from "./room-repository.js";

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
    status: row.status as CreateRoomStatus,
    createdAt: row.createdAt,
  };
}
