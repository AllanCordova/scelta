import { createPgliteDatabase, rooms, type Db } from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia@feature.test";
const memberPassword = "feature-member-password";

describe("admin rooms", () => {
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
    repository = createDrizzleRoomRepository(db, "Feature church");
    userRepository = createDrizzleUserRepository(db, "Feature church");
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
    await db.delete(rooms);
  });

  it("creates a draft room and lists it with a unique invite token", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição de presbíteros",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
      },
    });

    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.room).toMatchObject({
      title: "Eleição de presbíteros",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 34,
      quorumUnit: "percent",
      status: "draft",
      majorityRule: "absolute_majority",
    });
    expect(body.room.roundBehavior).toContain("most voted");
    expect(body.room.inviteToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.room.invitePath).toBe(`/join/${body.room.inviteToken}`);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().rooms).toEqual([
      expect.objectContaining({
        id: body.room.id,
        title: "Eleição de presbíteros",
        status: "draft",
        quorumValue: 34,
        quorumUnit: "percent",
      }),
    ]);
    expect(listed.json().rooms[0]).not.toHaveProperty("inviteToken");
    expect(listed.json().rooms[0]).not.toHaveProperty("invitePath");

    await app.close();
  });

  it("stores an open room and an absolute quorum override", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Diretoria",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        quorumValue: 40,
        quorumUnit: "absolute",
        status: "open",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().room).toMatchObject({
      quorumValue: 40,
      quorumUnit: "absolute",
      status: "open",
      rulesPreset: "ipb_society_board",
    });
    expect(created.json().room.roundBehavior).toContain("top two");

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });
    expect(listed.json().rooms).toEqual([
      expect.objectContaining({
        title: "Diretoria",
        status: "open",
        quorumUnit: "absolute",
        quorumValue: 40,
      }),
    ]);

    await app.close();
  });

  it("rejects an invalid percent quorum", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Assembleia",
        roomType: "custom",
        rulesPreset: "custom",
        quorumValue: 101,
        quorumUnit: "percent",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_room",
      details: [{ field: "quorumValue", code: "out_of_range" }],
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });
    expect(listed.json().rooms).toEqual([]);

    await app.close();
  });

  it("rejects a bearer token, anonymous callers, and members without storing a room", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = {
      title: "Assembleia",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
    };

    const bearer = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { authorization: "Bearer feature-admin-token" },
      payload: room,
    });
    expect(bearer.statusCode).toBe(401);
    expect(bearer.json()).toEqual({ error: "unauthorized" });

    const bearerList = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { authorization: "Bearer feature-admin-token" },
    });
    expect(bearerList.statusCode).toBe(401);
    expect(bearerList.json()).toEqual({ error: "unauthorized" });

    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      payload: room,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "unauthorized" });

    const listed = await app.inject({ method: "GET", url: "/v1/admin/rooms" });
    expect(listed.statusCode).toBe(401);
    expect(listed.json()).toEqual({ error: "unauthorized" });

    const member = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: memberCookie },
      payload: room,
    });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toEqual({ error: "forbidden" });

    const memberList = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: memberCookie },
    });
    expect(memberList.statusCode).toBe(403);
    expect(memberList.json()).toEqual({ error: "forbidden" });

    const stored = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });
    expect(stored.statusCode).toBe(200);
    expect(stored.json().rooms).toEqual([]);

    await app.close();
  });

  it("hides database errors from the client", async () => {
    const app = await buildApp({
      userRepository,
      roomRepository: {
        async createRoom() {
          throw new Error("duplicate key value violates unique constraint invite_token=secret");
        },
        async listRooms() {
          return [];
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Assembleia",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "persistence_failed" });
    expect(response.body).not.toContain("secret");
    await app.close();
  });

  it("gives each room its own invite token", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const first = await createRoom(app, "Primeira");
    const second = await createRoom(app, "Segunda");

    expect(first.inviteToken).not.toBe(second.inviteToken);

    await app.close();
  });

  async function createRoom(app: Awaited<ReturnType<typeof buildApp>>, title: string) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title,
        roomType: "deacon",
        rulesPreset: "ipb_local_officers",
      },
    });

    expect(response.statusCode).toBe(201);
    return response.json().room as { inviteToken: string };
  }
});

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
