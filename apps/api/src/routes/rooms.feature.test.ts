import {
  ballots,
  candidates,
  createPgliteDatabase,
  participants,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
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
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(participants);
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
      eligibleCount: 0,
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
        eligibleCount: 0,
        inviteToken: body.room.inviteToken,
        invitePath: body.room.invitePath,
        round: null,
      }),
    ]);

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
        eligibleCount: 12,
        status: "open",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().room).toMatchObject({
      quorumValue: 40,
      quorumUnit: "absolute",
      eligibleCount: 12,
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
        async findRoomByInviteToken() {
          return null;
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
        async removePresentParticipants() {
          return 0;
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

  it("deletes a room and enforces admin authorization", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala para excluir",
        roomType: "deacon",
        rulesPreset: "ipb_local_officers",
        candidates: ["Paulo", "Silas"],
      },
    });
    expect(created.statusCode).toBe(201);
    const roomId = created.json().room.id as string;

    const anonymousDelete = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${roomId}`,
    });
    expect(anonymousDelete.statusCode).toBe(401);

    const memberDelete = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: memberCookie },
    });
    expect(memberDelete.statusCode).toBe(403);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: adminCookie },
    });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: adminCookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "room_not_found" });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });
    expect(listed.json().rooms).toEqual([]);

    await app.close();
  });

  it("returns room detail with candidates, presence, and anonymous vote receipts while enforcing admin auth", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição de Presbíteros 2026",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        eligibleCount: 4,
        status: "open",
        candidates: ["Paulo Apóstolo", "Silas"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: { id: string; displayName: string }[];
    };

    const unauth = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
    });
    expect(unauth.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: memberCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const notFound = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms/00000000-0000-4000-8000-000000000000",
      headers: { cookie: adminCookie },
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ error: "room_not_found" });

    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { displayName: "Ana", joinKey: "join-key-ana-0001" },
    });
    expect(joinRes.statusCode).toBe(200);

    const openRoundRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(openRoundRes.statusCode).toBe(201);
    const roundId = openRoundRes.json().round.id as string;

    const firstCandidateId = room.candidates[0]!.id;
    const ballotRes = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: {
        joinKey: "join-key-ana-0001",
        candidateId: firstCandidateId,
      },
    });
    expect(ballotRes.statusCode).toBe(201);

    const detailOpen = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailOpen.statusCode).toBe(200);
    const openRoomDetail = detailOpen.json().room;
    expect(openRoomDetail).toMatchObject({
      id: room.id,
      title: "Eleição de Presbíteros 2026",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      eligibleCount: 4,
      inviteToken: room.inviteToken,
      invitePath: `/join/${room.inviteToken}`,
      presence: {
        presentCount: 1,
        eligibleCount: 4,
        requiredCount: 1,
        quorumMet: true,
      },
      votedCount: 1,
      round: {
        id: roundId,
        number: 1,
        status: "open",
        outcome: null,
      },
    });
    expect(openRoomDetail.round.tally).toBeUndefined();
    expect(openRoomDetail.receiptTimestamps).toHaveLength(1);
    expect(detailOpen.body).not.toContain("Ana");
    expect(detailOpen.body).not.toContain("join-key-ana-0001");

    const closeRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
    expect(closeRes.statusCode).toBe(200);

    const detailClosed = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailClosed.statusCode).toBe(200);
    expect(detailClosed.json().room.round).toMatchObject({
      id: roundId,
      status: "closed",
      outcome: "elected",
      tally: {
        totalVotes: 1,
        winnerId: firstCandidateId,
      },
    });

    await app.close();
  });

  it("removes present participants and updates quorum presence", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala remoção",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 2,
        quorumUnit: "absolute",
        status: "open",
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as { id: string; inviteToken: string };

    for (const [name, key] of [
      ["Ana", "join-key-ana-0001"],
      ["Bia", "join-key-bia-0002"],
    ] as const) {
      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}`,
        payload: { displayName: name, joinKey: key },
      });
      expect(joinRes.statusCode).toBe(200);
    }

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/remove`,
      headers: { cookie: memberCookie },
      payload: { count: 1 },
    });
    expect(forbidden.statusCode).toBe(403);

    const removed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/remove`,
      headers: { cookie: adminCookie },
      payload: { count: 1 },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({
      removedCount: 1,
      presence: {
        presentCount: 1,
        eligibleCount: 0,
        requiredCount: 2,
        quorumMet: false,
      },
    });

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
