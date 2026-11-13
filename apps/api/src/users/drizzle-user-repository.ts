import { sessions, users, type Db } from "@scelta/db";
import { eq } from "drizzle-orm";
import { getOrCreateChurch, isUniqueViolation } from "../churches/church-store.js";
import { hashSessionToken } from "../auth/session-cookie.js";
import {
  EmailAlreadyUsedError,
  type PublicUser,
  type StoredUser,
  type UserRepository,
  type UserRole,
} from "./user-repository.js";

export function createDrizzleUserRepository(db: Db, churchName: string): UserRepository {
  return {
    async findByEmail(email) {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const row = rows[0];
      return row ? toStoredUser(row) : null;
    },

    async insertUser(user) {
      const churchId = await getOrCreateChurch(db, churchName);
      try {
        const inserted = await db
          .insert(users)
          .values({
            churchId,
            name: user.name,
            email: user.email,
            passwordHash: user.passwordHash,
            role: user.role,
          })
          .returning();
        const row = inserted[0];
        if (!row) {
          throw new Error("User insert returned no row");
        }
        return toPublicUser(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new EmailAlreadyUsedError();
        }
        throw error;
      }
    },

    async findBySessionToken(token) {
      if (!token) {
        return null;
      }

      const tokenHash = hashSessionToken(token);
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          photoUrl: users.photoUrl,
          role: users.role,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }

      if (row.expiresAt.getTime() <= Date.now()) {
        await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
        return null;
      }

      return {
        id: row.id,
        name: row.name,
        email: row.email,
        photoUrl: row.photoUrl ?? null,
        role: row.role,
      };
    },

    async updateUserProfile(userId, input) {
      const updated = await db
        .update(users)
        .set({
          name: input.name,
          photoUrl: input.photoUrl,
        })
        .where(eq(users.id, userId))
        .returning();
      const row = updated[0];
      return row ? toPublicUser(row) : null;
    },

    async createSession(userId, token, expiresAt) {
      await db.insert(sessions).values({
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt,
      });
    },

    async deleteSession(token) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
    },
  };
}

function toStoredUser(row: {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  photoUrl?: string | null;
  role: UserRole;
}): StoredUser {
  return {
    ...toPublicUser(row),
    passwordHash: row.passwordHash,
  };
}

function toPublicUser(row: {
  id: string;
  name: string;
  email: string;
  photoUrl?: string | null;
  role: UserRole;
}): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    photoUrl: row.photoUrl ?? null,
    role: row.role,
  };
}
