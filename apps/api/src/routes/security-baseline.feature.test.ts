import {
  auditEvents,
  ballots,
  candidates,
  createPgliteDatabase,
  participants,
  roomMemberCodes,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-sec@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-sec@feature.test";
const memberPassword = "feature-member-password";

describe("B4.2 security baseline for voting", () => {
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
    repository = createDrizzleRoomRepository(db, "Security baseline church");
    userRepository = createDrizzleUserRepository(db, "Security baseline church");
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
    await db.delete(auditEvents);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
  });

  it("generates high-entropy invite tokens and rotates them, invalidating the old link", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala Segura",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Presb. Lucas"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as { id: string; inviteToken: string };
    expect(room.inviteToken.length).toBeGreaterThanOrEqual(40);

    const rotated = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/invite/rotate`,
      headers: { cookie: adminCookie },
    });
    expect(rotated.statusCode).toBe(200);
    const nextToken = (rotated.json().room as { inviteToken: string }).inviteToken;
    expect(nextToken).not.toBe(room.inviteToken);
    expect(nextToken.length).toBeGreaterThanOrEqual(40);

    const oldPreview = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}`,
    });
    expect(oldPreview.statusCode).toBe(404);

    const newPreview = await app.inject({
      method: "GET",
      url: `/v1/join/${nextToken}`,
    });
    expect(newPreview.statusCode).toBe(200);
    expect(newPreview.json().canJoin).toBe(true);

    await app.close();
  });

  it("blocks voters and non-admin members from all admin controls", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Controle Admin",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Presb. Lucas"],
      },
    });
    const room = created.json().room as { id: string };

    const adminRequests = [
      { method: "GET" as const, url: "/v1/admin/rooms" },
      { method: "GET" as const, url: `/v1/admin/rooms/${room.id}` },
      { method: "PATCH" as const, url: `/v1/admin/rooms/${room.id}`, payload: { title: "Hack" } },
      { method: "DELETE" as const, url: `/v1/admin/rooms/${room.id}` },
      { method: "POST" as const, url: `/v1/admin/rooms/${room.id}/invite/rotate` },
      { method: "POST" as const, url: `/v1/admin/rooms/${room.id}/rounds` },
      { method: "POST" as const, url: `/v1/admin/rooms/${room.id}/publish` },
      { method: "GET" as const, url: `/v1/admin/rooms/${room.id}/access-codes` },
      { method: "GET" as const, url: "/v1/admin/members" },
    ];

    for (const req of adminRequests) {
      const unauth = await app.inject({ method: req.method, url: req.url, payload: req.payload });
      expect(unauth.statusCode).toBe(401);

      const member = await app.inject({
        method: req.method,
        url: req.url,
        headers: { cookie: memberCookie },
        payload: req.payload,
      });
      expect(member.statusCode).toBe(403);
    }

    await app.close();
  });

  it("preserves the ballot anonymity invariant across all admin and voter endpoints", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sigilo Total",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 2,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Presb. Lucas", "Presb. André"],
      },
    });
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };

    const simCodes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 2 },
    });
    expect(simCodes.statusCode).toBe(200);
    const codes = simCodes.json().accessCodes as Array<{ code: string; displayName: string }>;

    const join1 = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[0]!.code, joinKey: "join-key-anon-0001" },
    });
    expect(join1.statusCode).toBe(200);

    const join2 = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[1]!.code, joinKey: "join-key-anon-0002" },
    });
    expect(join2.statusCode).toBe(200);

    const opened = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(opened.statusCode).toBe(201);
    const roundId = (opened.json().round as { id: string }).id;

    const vote1 = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "join-key-anon-0001", candidateId: room.candidates[0]!.id },
    });
    expect(vote1.statusCode).toBe(201);
    expect(vote1.json().receipt.candidateId).toBeUndefined();

    const vote2 = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "join-key-anon-0002", candidateId: room.candidates[1]!.id },
    });
    expect(vote2.statusCode).toBe(201);

    const closed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
    expect(closed.statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(200);
    const detailText = JSON.stringify(detail.json());
    expect(detailText).not.toContain("join-key-anon-0001");
    expect(detailText).not.toContain("join-key-anon-0002");
    expect(detailText).not.toContain(codes[0]!.displayName);
    expect(detailText).not.toContain(codes[1]!.displayName);

    const ballotRows = await db.select().from(ballots);
    expect(ballotRows).toHaveLength(2);
    for (const row of ballotRows) {
      expect(Object.keys(row)).not.toContain("participantId");
    }

    await app.close();
  });
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
  const header = response.headers["set-cookie"];
  const first = Array.isArray(header) ? header[0] : header;
  if (!first) {
    throw new Error("Expected login cookie");
  }
  return first.split(";")[0] ?? first;
}
