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
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import type { RoundStateSnapshot } from "../realtime.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-restart@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-restart@feature.test";
const memberPassword = "feature-member-password";
const anaKey = "join-key-ana-0001";
const biaKey = "join-key-bia-0002";

describe("round lifecycle and restart", () => {
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
    repository = createDrizzleRoomRepository(db, "Restart feature church");
    userRepository = createDrizzleUserRepository(db, "Restart feature church");
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
    await db.delete(candidates);
    await db.delete(rounds);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
  });

  it("clears ballots and receipts on restart, records an audit event, notifies state changes, and tallies only post-restart votes", async () => {
    const roundStateEvents: { roomId: string; snapshot: RoundStateSnapshot }[] = [];
    const app = await buildApp({
      roomRepository: repository,
      userRepository,
      presencePublisher: {
        publishPresence() {
          // Presence tested separately
        },
        publishRoundState(roomId, snapshot) {
          roundStateEvents.push({ roomId, snapshot });
        },
      },
    });

    const room = await createRoom(app, {
      title: "Assembleia com reinício",
      quorumValue: 2,
      candidates: ["Paulo", "Silas"],
    });
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;
    const silas = room.candidates.find((c) => c.displayName === "Silas")!;

    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);

    const opened = await openRound(app, room.id);
    expect(opened.statusCode).toBe(201);
    const roundId = opened.json().round.id as string;

    // Both voters cast ballots for Paulo before restart
    expect((await castVote(app, room.inviteToken, anaKey, paulo.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, biaKey, paulo.id)).statusCode).toBe(201);
    expect(await db.select().from(ballots)).toHaveLength(2);
    expect(await db.select().from(voteReceipts)).toHaveLength(2);

    // Admin restarts the open round
    const restarted = await restartRound(app, room.id, roundId);
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json()).toEqual({
      round: {
        id: roundId,
        number: 1,
        status: "open",
        outcome: null,
        restartCount: 1,
      },
    });

    // Ballots and receipts are cleared in DB
    expect(await db.select().from(ballots)).toEqual([]);
    expect(await db.select().from(voteReceipts)).toEqual([]);

    // Audit event is written without any voter choice or PII
    const events = await repository.listAuditEvents(room.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      roomId: room.id,
      actorRole: "admin",
      action: "round_restarted",
      payload: {
        roundId,
        roundNumber: 1,
      },
    });

    // Voter ballot state exposes restartCount and receipt resets to hasVoted: false
    const ballotState = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotState.statusCode).toBe(200);
    expect(ballotState.json().round).toEqual({
      id: roundId,
      number: 1,
      status: "open",
      outcome: null,
      restartCount: 1,
    });

    const receiptAfterRestart = await checkReceipt(app, room.inviteToken, anaKey);
    expect(receiptAfterRestart.json()).toEqual({ roundId, hasVoted: false });

    // Both voters now vote for Silas after restart
    expect((await castVote(app, room.inviteToken, anaKey, silas.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, biaKey, silas.id)).statusCode).toBe(201);

    const closed = await closeRound(app, room.id, roundId);
    expect(closed.statusCode).toBe(200);
    expect(closed.json().round).toEqual({
      id: roundId,
      number: 1,
      status: "closed",
      outcome: "elected",
      restartCount: 1,
      tally: {
        totalVotes: 2,
        nullVotes: 0,
        threshold: 2,
        outcome: "elected",
        winnerId: silas.id,
        winnerName: "Silas",
        standings: [
          { candidateId: silas.id, displayName: "Silas", votes: 2 },
          { candidateId: paulo.id, displayName: "Paulo", votes: 0 },
        ],
      },
    });

    // Realtime publisher notified open, restarted, and closed state transitions
    expect(roundStateEvents).toEqual([
      { roomId: room.id, snapshot: { roundId, roundNumber: 1, state: "open" } },
      { roomId: room.id, snapshot: { roundId, roundNumber: 1, state: "restarted" } },
      { roomId: room.id, snapshot: { roundId, roundNumber: 1, state: "closed" } },
    ]);

    await app.close();
  });

  it("resets round number back to 1 and restores all candidates when restarting a later round", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, {
      title: "Reinício para marca 1",
      quorumValue: 2,
      candidates: ["Paulo", "Silas", "Barnabé"],
    });
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;
    const silas = room.candidates.find((c) => c.displayName === "Silas")!;

    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);

    // 1st round: tie -> no_majority
    const r1 = await openRound(app, room.id);
    const r1Id = r1.json().round.id as string;
    await castVote(app, room.inviteToken, anaKey, paulo.id);
    await castVote(app, room.inviteToken, biaKey, silas.id);
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r1Id}/close`,
      headers: { cookie: adminCookie },
    });

    // 2nd round: tie -> no_majority
    const r2 = await openRound(app, room.id);
    const r2Id = r2.json().round.id as string;
    await castVote(app, room.inviteToken, anaKey, paulo.id);
    await castVote(app, room.inviteToken, biaKey, silas.id);
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r2Id}/close`,
      headers: { cookie: adminCookie },
    });

    // 3rd round: narrowed to top 2 (Paulo, Silas), Barnabé eliminated
    const r3 = await openRound(app, room.id);
    expect(r3.statusCode).toBe(201);
    expect(r3.json().round.number).toBe(3);
    expect(r3.json().candidates).toHaveLength(2);
    const r3Id = r3.json().round.id as string;

    // Restarting 3rd round resets back to round 1 and restores all 3 candidates
    const restarted = await restartRound(app, room.id, r3Id);
    expect(restarted.statusCode).toBe(200);
    expect(restarted.json()).toEqual({
      round: {
        id: r3Id,
        number: 1,
        status: "open",
        outcome: null,
        restartCount: 1,
      },
    });

    const eligibleAfterRestart = await repository.listCandidates(room.id);
    expect(eligibleAfterRestart.map((c) => c.displayName)).toEqual(["Barnabé", "Paulo", "Silas"]);

    await app.close();
  });

  it("enforces admin authorization and rejects restarting closed or missing rounds", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, {
      title: "Proteção de reinício",
      quorumValue: 1,
      candidates: ["Paulo"],
    });
    await join(app, room.inviteToken, "Ana", anaKey);

    const opened = await openRound(app, room.id);
    const roundId = opened.json().round.id as string;

    const unauthenticated = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/restart`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const memberAttempt = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/restart`,
      headers: { cookie: memberCookie },
    });
    expect(memberAttempt.statusCode).toBe(403);

    const missingRound = await restartRound(
      app,
      room.id,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(missingRound.statusCode).toBe(404);
    expect(missingRound.json()).toEqual({ error: "round_not_found" });

    expect((await castVote(app, room.inviteToken, anaKey, null)).statusCode).toBe(201);
    const closedRound = await closeRound(app, room.id, roundId);
    expect(closedRound.statusCode).toBe(200);
    const restartClosed = await restartRound(app, room.id, roundId);
    expect(restartClosed.statusCode).toBe(409);
    expect(restartClosed.json()).toEqual({ error: "round_not_open" });

    expect(await repository.listAuditEvents(room.id)).toEqual([]);

    await app.close();
  });

  async function createRoom(
    app: Awaited<ReturnType<typeof buildApp>>,
    input: { title: string; quorumValue: number; candidates: string[] },
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: input.title,
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        status: "open",
        quorumValue: input.quorumValue,
        quorumUnit: "absolute",
        candidates: input.candidates,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().room as {
      id: string;
      inviteToken: string;
      candidates: { id: string; displayName: string }[];
    };
  }

  async function join(
    app: Awaited<ReturnType<typeof buildApp>>,
    token: string,
    _displayName: string,
    joinKey: string,
  ) {
    const room = await repository.findRoomByInviteToken(token);
    const [simCode] = room ? await repository.createSimulatedAccessCodes(room.id, 1) : [];
    return app.inject({
      method: "POST",
      url: `/v1/join/${token}`,
      payload: { code: simCode?.code ?? "ZZZZZZ", joinKey },
    });
  }

  function openRound(app: Awaited<ReturnType<typeof buildApp>>, roomId: string) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/rounds`,
      headers: { cookie: adminCookie },
    });
  }

  function closeRound(app: Awaited<ReturnType<typeof buildApp>>, roomId: string, roundId: string) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
  }

  function restartRound(
    app: Awaited<ReturnType<typeof buildApp>>,
    roomId: string,
    roundId: string,
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/rounds/${roundId}/restart`,
      headers: { cookie: adminCookie },
    });
  }

  function castVote(
    app: Awaited<ReturnType<typeof buildApp>>,
    token: string,
    joinKey: string,
    candidateId: string | null,
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/join/${token}/ballot`,
      payload: { joinKey, candidateId },
    });
  }

  function checkReceipt(
    app: Awaited<ReturnType<typeof buildApp>>,
    token: string,
    joinKey: string,
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/join/${token}/ballot/receipt`,
      payload: { joinKey },
    });
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
  const setCookie = response.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
  const match = /scelta_session=([^;]+)/.exec(header);
  const value = match?.[1];
  if (!value) {
    throw new Error("Missing session cookie");
  }
  return `scelta_session=${value}`;
}
