import { createPgliteDatabase, participants, rooms, type Db } from "@scelta/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import { hashJoinKey } from "../rooms/join-key.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-join@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-join@feature.test";
const memberPassword = "feature-member-password";
const anaKey = "join-key-ana-0001";
const biaKey = "join-key-bia-0002";

describe("join room", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;
  let memberCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Join feature church");
    userRepository = createDrizzleUserRepository(db, "Join feature church");
    await userRepository.insertUser({
      name: "Ada",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });
    await userRepository.insertUser({
      name: "Mia",
      email: memberEmail,
      passwordHash: await hashPassword(memberPassword),
      role: "member",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });
    adminCookie = await loginCookie(app, adminEmail, adminPassword);
    memberCookie = await loginCookie(app, memberEmail, memberPassword);
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    resetAuthAttempts();
    await db.delete(participants);
    await db.delete(rooms);
  });

  it("joins an open room, dedups the same key, and publishes the present count", async () => {
    const events: {
      roomId: string;
      presentCount: number;
      eligibleCount: number;
      requiredCount: number;
      quorumMet: boolean;
    }[] = [];
    const app = await buildApp({
      roomRepository: repository,
      userRepository,
      presencePublisher: {
        publishPresence(roomId, presence) {
          events.push({ roomId, ...presence });
        },
      },
    });
    const room = await createRoom(app, "Assembleia", "open");

    const preview = await app.inject({ method: "GET", url: `/v1/join/${room.inviteToken}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({ title: "Assembleia", status: "open", canJoin: true });
    expect(preview.json()).not.toHaveProperty("inviteToken");

    const first = await join(app, room.inviteToken, "  Ana  ", anaKey);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      title: "Assembleia",
      status: "open",
      displayName: "Ana",
      presentCount: 1,
      alreadyJoined: false,
    });
    expect(first.body).not.toContain(anaKey);

    const duplicate = await join(app, room.inviteToken, "Ana Maria", anaKey);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      displayName: "Ana",
      presentCount: 1,
      alreadyJoined: true,
    });

    const secondPerson = await join(app, room.inviteToken, "Ana", biaKey);
    expect(secondPerson.statusCode).toBe(200);
    expect(secondPerson.json()).toMatchObject({
      displayName: "Ana",
      presentCount: 2,
      alreadyJoined: false,
    });

    const presence = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/presence`,
      headers: { cookie: adminCookie },
    });
    expect(presence.statusCode).toBe(200);
    expect(presence.json()).toEqual({
      presentCount: 2,
      eligibleCount: 0,
      requiredCount: 0,
      quorumMet: false,
    });

    const stored = await db.select().from(participants);
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.joinKeyHash).sort()).toEqual(
      [hashJoinKey(anaKey), hashJoinKey(biaKey)].sort(),
    );
    expect(stored.every((row) => row.isPresent)).toBe(true);
    const unmet = (presentCount: number) => ({
      roomId: room.id,
      presentCount,
      eligibleCount: 0,
      requiredCount: 0,
      quorumMet: false,
    });
    expect(events).toEqual([unmet(1), unmet(1), unmet(2)]);

    await app.close();
  });

  it("lets a voting room be joined and restores presence without a second row", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, "Votação", "open");
    await db.update(rooms).set({ status: "voting" }).where(eq(rooms.id, room.id));

    const first = await join(app, room.inviteToken, "Ana", anaKey);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: "voting", presentCount: 1, alreadyJoined: false });

    await db.update(participants).set({ isPresent: false }).where(eq(participants.roomId, room.id));
    const absent = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/presence`,
      headers: { cookie: adminCookie },
    });
    expect(absent.json()).toEqual({
      presentCount: 0,
      eligibleCount: 0,
      requiredCount: 0,
      quorumMet: false,
    });

    const restored = await join(app, room.inviteToken, "Ana", anaKey);
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ presentCount: 1, alreadyJoined: true, displayName: "Ana" });

    const stored = await db.select().from(participants);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.isPresent).toBe(true);

    await app.close();
  });

  it("rejects draft, closed, and cancelled rooms without counting presence", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const draft = await createRoom(app, "Rascunho", "draft");
    await expectRejected(app, draft.inviteToken, "draft");

    const closed = await createRoom(app, "Encerrada", "open");
    await db.update(rooms).set({ status: "closed" }).where(eq(rooms.id, closed.id));
    await expectRejected(app, closed.inviteToken, "closed");

    const cancelled = await createRoom(app, "Cancelada", "open");
    await db.update(rooms).set({ status: "cancelled" }).where(eq(rooms.id, cancelled.id));
    await expectRejected(app, cancelled.inviteToken, "cancelled");

    expect(await db.select().from(participants)).toHaveLength(0);
    await app.close();
  });

  it("rejects an unknown invite", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const token = "a".repeat(43);

    const preview = await app.inject({ method: "GET", url: `/v1/join/${token}` });
    expect(preview.statusCode).toBe(404);
    expect(preview.json()).toEqual({ error: "invite_not_found" });

    const joined = await join(app, token, "Ana", anaKey);
    expect(joined.statusCode).toBe(404);
    expect(joined.json()).toEqual({ error: "invite_not_found" });

    await app.close();
  });

  it("rejects a blank name and a short join key", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, "Assembleia", "open");

    const response = await join(app, room.inviteToken, "   ", "short");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_join",
      details: [
        { field: "displayName", code: "required" },
        { field: "joinKey", code: "out_of_range" },
      ],
    });
    expect(await db.select().from(participants)).toHaveLength(0);

    await app.close();
  });

  it("hides persistence failures and keeps presence admin-only", async () => {
    const app = await buildApp({
      userRepository,
      roomRepository: {
        async createRoom() {
          throw new Error("not implemented");
        },
        async listRooms() {
          return [];
        },
        async findRoomByInviteToken() {
          throw new Error("join_key=super-secret-key");
        },
        async findRoomById() {
          return null;
        },
        async deleteRoom() {
          return false;
        },
        async joinRoom() {
          throw new Error("not implemented");
        },
        async countPresent() {
          return 0;
        },
        async listCandidates() {
          return [];
        },
        async listCandidatesByRooms() {
          return [];
        },
        async openRound() {
          throw new Error("not implemented");
        },
        async closeRound() {
          return null;
        },
        async restartRound() {
          return null;
        },
        async findRound() {
          return null;
        },
        async latestRounds() {
          return [];
        },
        async latestClosedRound() {
          return null;
        },
        async listAuditEvents() {
          return [];
        },
        async castBallot() {
          return { ok: false, reason: "round_not_open" };
        },
        async hasVotedInRound() {
          return false;
        },
        async listRoundBallotCandidateIds() {
          return [];
        },
        async listRoundReceiptTimestamps() {
          return [];
        },
        async importMembers() {
          return { createdCount: 0, updatedCount: 0 };
        },
        async listMembers() {
          return [];
        },
      },
    });

    const leaked = await join(app, "invite-token", "Ana", anaKey);
    expect(leaked.statusCode).toBe(500);
    expect(leaked.json()).toEqual({ error: "persistence_failed" });
    expect(leaked.body).not.toContain("super-secret-key");

    const unavailable = await buildApp();
    const missingDb = await unavailable.inject({ method: "GET", url: "/v1/join/qualquer" });
    expect(missingDb.statusCode).toBe(503);
    expect(missingDb.json()).toEqual({ error: "persistence_unavailable" });
    await unavailable.close();
    await app.close();

    const openRoom = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(openRoom, "Assembleia", "open");

    const anonymous = await openRoom.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/presence`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "unauthorized" });

    const member = await openRoom.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/presence`,
      headers: { cookie: memberCookie },
    });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toEqual({ error: "forbidden" });

    const missing = await openRoom.inject({
      method: "GET",
      url: "/v1/admin/rooms/00000000-0000-4000-8000-000000000000/presence",
      headers: { cookie: adminCookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "room_not_found" });

    await openRoom.close();
  });

  async function createRoom(
    app: Awaited<ReturnType<typeof buildApp>>,
    title: string,
    status: "draft" | "open",
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title,
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        status,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().room as { id: string; inviteToken: string };
  }
});

async function expectRejected(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  status: string,
) {
  const preview = await app.inject({ method: "GET", url: `/v1/join/${token}` });
  expect(preview.statusCode).toBe(200);
  expect(preview.json()).toMatchObject({ status, canJoin: false });

  const joined = await join(app, token, "Ana", anaKey);
  expect(joined.statusCode).toBe(409);
  expect(joined.json()).toEqual({ error: "room_not_joinable", status });
}

function join(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  displayName: string,
  joinKey: string,
) {
  return app.inject({
    method: "POST",
    url: `/v1/join/${token}`,
    payload: { displayName, joinKey },
  });
}

async function loginCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
  password: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response.headers["set-cookie"]);
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
  const match = /scelta_session=([^;]+)/.exec(header);
  const value = match?.[1];
  if (!value) {
    throw new Error("Missing session cookie");
  }
  return `scelta_session=${value}`;
}
