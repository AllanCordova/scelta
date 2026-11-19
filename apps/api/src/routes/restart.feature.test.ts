import {
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
  roomMemberCodes,
  roomRoster,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import type { RoundStateSnapshot } from "../realtime.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { clearAuditEvents } from "../testing/database.js";
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
    await clearAuditEvents(db);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(candidates);
    await db.delete(rounds);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(roomRoster);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("annuls the restarted round while preserving its ballots and receipts, opens a new round with the next number, and records annulled totals in the audit log", async () => {
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
    const newRoundId = restarted.json().round.id as string;
    expect(newRoundId).not.toBe(roundId);
    expect(restarted.json()).toEqual({
      round: {
        id: newRoundId,
        number: 2,
        status: "open",
        outcome: null,
        restartCount: 1,
      },
    });

    // Previous round is marked restarted + annulled, and its ballots and receipts are preserved in DB
    const annulledRound = await repository.findRound(room.id, roundId);
    expect(annulledRound).toMatchObject({
      id: roundId,
      number: 1,
      status: "restarted",
      outcome: "annulled",
    });
    expect(annulledRound?.closedAt).toBeInstanceOf(Date);
    expect(await db.select().from(ballots).where(eq(ballots.roundId, roundId))).toHaveLength(2);
    expect(
      await db.select().from(voteReceipts).where(eq(voteReceipts.roundId, roundId)),
    ).toHaveLength(2);

    // Audit event records the annulled round, new round, and annulled totals without voter PII
    const events = await repository.listAuditEvents(room.id);
    const restartEvents = events.filter((event) => event.action === "round_restarted");
    expect(restartEvents).toHaveLength(1);
    expect(restartEvents[0]).toMatchObject({
      roomId: room.id,
      actorRole: "admin",
      action: "round_restarted",
      payload: {
        roundId: newRoundId,
        roundNumber: 2,
        annulledRoundId: roundId,
        annulledRoundNumber: 1,
        annulledTotals: {
          totalBallots: 2,
          blankVotes: 0,
          byCandidate: { [paulo.id]: 2 },
        },
      },
    });

    // Voter ballot state exposes the new open round and receipt resets to hasVoted: false for the new round
    const ballotState = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotState.statusCode).toBe(200);
    expect(ballotState.json().round).toEqual({
      id: newRoundId,
      number: 2,
      status: "open",
      outcome: null,
      restartCount: 1,
    });

    const receiptAfterRestart = await checkReceipt(app, room.inviteToken, anaKey);
    expect(receiptAfterRestart.json()).toEqual({ roundId: newRoundId, hasVoted: false });

    // Both voters now vote for Silas in the new round
    expect((await castVote(app, room.inviteToken, anaKey, silas.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, biaKey, silas.id)).statusCode).toBe(201);

    const closed = await closeRound(app, room.id, newRoundId);
    expect(closed.statusCode).toBe(200);
    expect(closed.json().round).toEqual({
      id: newRoundId,
      number: 2,
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
      { roomId: room.id, snapshot: { roundId: newRoundId, roundNumber: 2, state: "restarted" } },
      { roomId: room.id, snapshot: { roundId: newRoundId, roundNumber: 2, state: "closed" } },
    ]);

    await app.close();
  });

  it("keeps closed rounds intact when restarting a later round and preserves the 3-round office limit", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, {
      title: "Reinício sem apagar histórico",
      quorumValue: 2,
      candidates: ["Paulo", "Silas", "Barnabé"],
    });
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;
    const silas = room.candidates.find((c) => c.displayName === "Silas")!;
    const barnabe = room.candidates.find((c) => c.displayName === "Barnabé")!;

    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);

    // 1st round: tie -> no_majority
    const r1 = await openRound(app, room.id);
    const r1Id = r1.json().round.id as string;
    await castVote(app, room.inviteToken, anaKey, paulo.id);
    await castVote(app, room.inviteToken, biaKey, silas.id);
    await closeRound(app, room.id, r1Id);

    // 2nd round: open, cast 1 vote, then restart -> 1st round stays intact, 2nd round is annulled, new round #3 opens as the 2nd valid ballot
    const r2 = await openRound(app, room.id);
    const r2Id = r2.json().round.id as string;
    await castVote(app, room.inviteToken, anaKey, barnabe.id);

    const restartedR2 = await restartRound(app, room.id, r2Id);
    expect(restartedR2.statusCode).toBe(200);
    const r2ReplacementId = restartedR2.json().round.id as string;
    expect(restartedR2.json().round).toMatchObject({
      id: r2ReplacementId,
      number: 3,
      status: "open",
      outcome: null,
      restartCount: 1,
    });

    // 1st closed round and its 2 ballots remain untouched
    const storedR1 = await repository.findRound(room.id, r1Id);
    expect(storedR1).toMatchObject({
      id: r1Id,
      number: 1,
      status: "closed",
      outcome: "no_majority",
    });
    expect(await db.select().from(ballots).where(eq(ballots.roundId, r1Id))).toHaveLength(2);

    // Complete the 2nd valid ballot (round #3) with a tie -> no_majority
    await castVote(app, room.inviteToken, anaKey, paulo.id);
    await castVote(app, room.inviteToken, biaKey, silas.id);
    await closeRound(app, room.id, r2ReplacementId);

    // 3rd valid ballot (round #4): narrowed to top 2 (Paulo, Silas), Barnabé eliminated
    const r3 = await openRound(app, room.id);
    expect(r3.statusCode).toBe(201);
    expect(r3.json().round.number).toBe(4);
    expect(r3.json().candidates).toHaveLength(2);
    const r3Id = r3.json().round.id as string;

    // Restarting the 3rd valid ballot annuls round #4 and opens round #5 while keeping the narrowed candidate pool (Paulo, Silas) and still counting as the 3rd valid ballot
    const restartedR3 = await restartRound(app, room.id, r3Id);
    expect(restartedR3.statusCode).toBe(200);
    const r3ReplacementId = restartedR3.json().round.id as string;
    expect(restartedR3.json().round).toMatchObject({
      id: r3ReplacementId,
      number: 5,
      status: "open",
      outcome: null,
      restartCount: 2,
    });

    const eligibleAfterRestart = await repository.listCandidates(room.id);
    expect(eligibleAfterRestart.map((c) => c.displayName)).toEqual(["Paulo", "Silas"]);

    // Tie on the 3rd valid ballot (round #5) triggers 3rd-round tie-break rules and blocks opening a 4th valid ballot
    await castVote(app, room.inviteToken, anaKey, paulo.id);
    await castVote(app, room.inviteToken, biaKey, silas.id);
    const closedR3 = await closeRound(app, room.id, r3ReplacementId);
    expect(closedR3.statusCode).toBe(200);
    expect(closedR3.json().round.tally.tieBreakRequired).toBe(true);

    const blockedFourth = await openRound(app, room.id);
    expect(blockedFourth.statusCode).toBe(409);
    expect(blockedFourth.json()).toEqual({ error: "max_rounds_reached" });

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

    const events = await repository.listAuditEvents(room.id);
    expect(events.some((event) => event.action === "round_restarted")).toBe(false);

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
    displayName: string,
    joinKey: string,
  ) {
    const room = await repository.findRoomByInviteToken(token);
    if (!room) {
      return app.inject({
        method: "POST",
        url: `/v1/join/${token}`,
        payload: { code: "ZZZZZZ", joinKey },
      });
    }
    const memberName = `${displayName} (${joinKey.slice(-6)})`;
    const generated = await repository.listAccessCodes(room.id);
    let memberCode = generated.find((item) => item.displayName === memberName && !item.revokedAt);
    if (!memberCode) {
      const added = await repository.addRosterEntry!(room.id, {
        fullName: memberName,
        birthDate: "1990-01-01",
      });
      if (added.ok) {
        memberCode = added.accessCode;
      }
    }
    return app.inject({
      method: "POST",
      url: `/v1/join/${token}`,
      payload: { code: memberCode?.code ?? "ZZZZZZ", joinKey },
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
