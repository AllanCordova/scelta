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

const adminEmail = "ada-audit@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-audit@feature.test";
const memberPassword = "feature-member-password";

describe("admin audit log", () => {
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
    repository = createDrizzleRoomRepository(db, "Audit feature church");
    userRepository = createDrizzleUserRepository(db, "Audit feature church");
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

  it("audits create room, quorum change, start, restart, close, and publish result in append-only order", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição Auditada",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Presb. Marcos"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string }>;
    };
    const candidateId = room.candidates[0]!.id;

    // Change quorum
    const patchQuorum = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { quorumValue: 1, quorumUnit: "percent", eligibleCount: 1 },
    });
    expect(patchQuorum.statusCode).toBe(200);

    // Join 1 participant to meet quorum
    const simCodes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 1 },
    });
    const code = (simCodes.json().accessCodes as Array<{ code: string }>)[0]!.code;
    const joined = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code, joinKey: "audit-voter-key-01" },
    });
    expect(joined.statusCode).toBe(200);

    // Start round
    const opened = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(opened.statusCode).toBe(201);
    const roundId = (opened.json().round as { id: string }).id;

    // Restart round
    const restarted = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/restart`,
      headers: { cookie: adminCookie },
    });
    expect(restarted.statusCode).toBe(200);

    // Cast vote & close round
    const cast = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "audit-voter-key-01", candidateId },
    });
    expect(cast.statusCode).toBe(201);

    const closed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().round.outcome).toBe("elected");

    // Publish result
    const published = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/publish`,
      headers: { cookie: adminCookie },
    });
    expect(published.statusCode).toBe(200);

    // Verify audit endpoint authz
    const unauthAudit = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
    });
    expect(unauthAudit.statusCode).toBe(401);

    const memberAudit = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: memberCookie },
    });
    expect(memberAudit.statusCode).toBe(403);

    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(auditRes.statusCode).toBe(200);
    const events = auditRes.json().events as Array<{
      id: string;
      action: string;
      payload: Record<string, unknown>;
    }>;

    expect(events.map((event) => event.action)).toEqual([
      "room_created",
      "quorum_changed",
      "round_opened",
      "round_restarted",
      "round_closed",
      "result_published",
    ]);

    const quorumEvent = events.find((event) => event.action === "quorum_changed");
    expect(quorumEvent?.payload).toMatchObject({
      previous: { quorumValue: 1, quorumUnit: "absolute", eligibleCount: 0 },
      next: { quorumValue: 1, quorumUnit: "percent", eligibleCount: 1 },
    });

    // Verify room detail also includes auditEvents
    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().room.auditEvents).toHaveLength(6);

    // Verify audit entries are immutable via API
    const firstEventId = events[0]!.id;
    const deleteAttempt = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${room.id}/audit/${firstEventId}`,
      headers: { cookie: adminCookie },
    });
    expect(deleteAttempt.statusCode).toBe(404);

    const patchAttempt = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/audit/${firstEventId}`,
      headers: { cookie: adminCookie },
      payload: { action: "tampered" },
    });
    expect(patchAttempt.statusCode).toBe(404);

    const afterTamperAttempts = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(afterTamperAttempts.json().events).toHaveLength(6);

    const postAttempt = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
      payload: { action: "forged" },
    });
    expect(postAttempt.statusCode).toBe(404);

    const putAttempt = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/audit/${firstEventId}`,
      headers: { cookie: adminCookie },
      payload: { action: "forged" },
    });
    expect(putAttempt.statusCode).toBe(404);

    // Non-quorum title edit should not emit quorum_changed
    const titlePatch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { title: "Eleição Auditada Renomeada" },
    });
    expect(titlePatch.statusCode).toBe(200);

    const afterTitlePatch = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(afterTitlePatch.json().events).toHaveLength(6);

    // Unknown room and invalid UUID
    const missingRoomAudit = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms/00000000-0000-4000-8000-000000000000/audit",
      headers: { cookie: adminCookie },
    });
    expect(missingRoomAudit.statusCode).toBe(404);

    const invalidUuidAudit = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms/not-a-uuid/audit",
      headers: { cookie: adminCookie },
    });
    expect(invalidUuidAudit.statusCode).toBe(400);

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
