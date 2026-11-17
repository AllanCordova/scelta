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
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { clearAuditEvents } from "../testing/database.js";
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
    await clearAuditEvents(db);
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
        status: "test",
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

    // Restart round -> annuls roundId and opens a new round
    const restarted = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/restart`,
      headers: { cookie: adminCookie },
    });
    expect(restarted.statusCode).toBe(200);
    const activeRoundId = (restarted.json().round as { id: string }).id;

    // Cast vote & close the new open round
    const cast = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "audit-voter-key-01", candidateId },
    });
    expect(cast.statusCode).toBe(201);

    const closed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${activeRoundId}/close`,
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

  it("restricts simulation tools to test rooms and preserves undeletable human-voting proof logs even after room deletion", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    await repository.createMember({
      fullName: "Membro Real Verificado",
      isCommunicant: true,
      isMale: true,
      birthDate: "1988-04-10",
      societyFlags: {},
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Assembleia Oficial Comprovada",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Membro Real Verificado"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string }>;
    };

    // Simulation tools must be blocked on non-"test" rooms
    const blockedSim = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 1 },
    });
    expect(blockedSim.statusCode).toBe(409);
    expect(blockedSim.json()).toMatchObject({ error: "simulation_requires_test_room" });

    const blockedRemove = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/remove`,
      headers: { cookie: adminCookie },
      payload: { count: 1 },
    });
    expect(blockedRemove.statusCode).toBe(409);
    expect(blockedRemove.json()).toMatchObject({ error: "simulation_requires_test_room" });

    // Real member joins and casts ballot
    const generated = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    expect(generated.statusCode).toBe(200);
    const memberCode = (generated.json().accessCodes as Array<{ code: string }>)[0]!.code;

    const joined = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: memberCode, joinKey: "real-member-join-key-001" },
    });
    expect(joined.statusCode).toBe(200);

    const opened = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(opened.statusCode).toBe(201);

    const cast = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: {
        joinKey: "real-member-join-key-001",
        candidateId: room.candidates[0]!.id,
      },
    });
    expect(cast.statusCode).toBe(201);

    // Inspect global integrity logs
    const logsRes = await app.inject({
      method: "GET",
      url: `/v1/admin/logs?roomId=${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(logsRes.statusCode).toBe(200);
    const logsBody = logsRes.json() as {
      logs: Array<{
        id: string;
        action: string;
        actorRole: string;
        payload: Record<string, unknown>;
        integrityHash: string;
      }>;
      summary: {
        humanBallotsCast: number;
        simulatedBallotsCast: number;
        humanParticipantsJoined: number;
        adminVoteInterventions: number;
        immutable: boolean;
      };
    };

    expect(logsBody.summary).toMatchObject({
      humanBallotsCast: 1,
      simulatedBallotsCast: 0,
      humanParticipantsJoined: 1,
      adminVoteInterventions: 0,
      immutable: true,
    });

    const ballotLog = logsBody.logs.find((entry) => entry.action === "ballot_cast");
    expect(ballotLog).toBeDefined();
    expect(ballotLog?.actorRole).toBe("voter");
    expect(ballotLog?.payload).toMatchObject({
      voterOrigin: "authenticated_member",
      isSimulated: false,
      memberVerified: true,
      adminIntervention: false,
    });
    expect(ballotLog?.integrityHash).toMatch(/^[A-F0-9]{16}$/);

    // Logs cannot be deleted or modified even by admin
    const deleteAllLogs = await app.inject({
      method: "DELETE",
      url: "/v1/admin/logs",
      headers: { cookie: adminCookie },
    });
    expect(deleteAllLogs.statusCode).toBe(403);
    expect(deleteAllLogs.json()).toMatchObject({ error: "logs_are_immutable" });

    const deleteSingleLog = await app.inject({
      method: "DELETE",
      url: `/v1/admin/logs/${ballotLog!.id}`,
      headers: { cookie: adminCookie },
    });
    expect(deleteSingleLog.statusCode).toBe(403);
    expect(deleteSingleLog.json()).toMatchObject({ error: "logs_are_immutable" });

    // Deleting the room preserves all logs and appends room_deleted
    const deleteRoomRes = await app.inject({
      method: "DELETE",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(deleteRoomRes.statusCode).toBe(204);

    const logsAfterRoomDelete = await app.inject({
      method: "GET",
      url: `/v1/admin/logs?roomId=${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(logsAfterRoomDelete.statusCode).toBe(200);
    const preservedActions = (
      logsAfterRoomDelete.json().logs as Array<{ action: string; roomTitle: string }>
    ).map((entry) => entry.action);
    expect(preservedActions).toEqual([
      "room_created",
      "participant_joined",
      "round_opened",
      "ballot_cast",
      "room_deleted",
    ]);

    await app.close();
  });

  it("enforces database-level immutability with a trigger and detects chain tampering via the verify endpoint", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Cadeia Imutável",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Presb. Marcos"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { quorumValue: 2 },
    });

    const verifyRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit/verify`,
      headers: { cookie: adminCookie },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json()).toMatchObject({
      chainValid: true,
      totalEvents: 2,
    });
    expect(verifyRes.json().chainTipHash).toMatch(/^[A-F0-9]{16}$/);

    // Direct SQL UPDATE or DELETE on audit_events is blocked by the PostgreSQL trigger
    const storedEvents = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.roomId, room.id));
    expect(storedEvents).toHaveLength(2);
    const firstEventId = storedEvents[0]!.id;

    await expect(
      db
        .update(auditEvents)
        .set({ action: "tampered_action" })
        .where(eq(auditEvents.id, firstEventId)),
    ).rejects.toThrow(/audit_events is append-only and immutable/i);

    await expect(
      db.delete(auditEvents).where(eq(auditEvents.id, firstEventId)),
    ).rejects.toThrow(/audit_events is append-only and immutable/i);

    // If a privileged DB superuser temporarily disables the trigger and alters a row, chain verification catches it
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable_trg`);
    try {
      await db
        .update(auditEvents)
        .set({ payload: { tampered: true } })
        .where(eq(auditEvents.id, firstEventId));
    } finally {
      await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable_trg`);
    }

    const verifyAfterTamper = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit/verify`,
      headers: { cookie: adminCookie },
    });
    expect(verifyAfterTamper.statusCode).toBe(200);
    expect(verifyAfterTamper.json()).toMatchObject({
      chainValid: false,
      totalEvents: 2,
      brokenAtEventId: firstEventId,
    });

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
