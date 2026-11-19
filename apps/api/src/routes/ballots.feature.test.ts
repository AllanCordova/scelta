import {
  auditEvents,
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
import { BALLOT_RATE_LIMIT } from "../security/rate-limiter.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { clearAuditEvents } from "../testing/database.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-ballot@feature.test";
const adminPassword = "feature-admin-password";
const anaKey = "join-key-ana-0001";
const biaKey = "join-key-bia-0002";
const caioKey = "join-key-caio-0003";

describe("anonymous single ballot and automatic tally", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Ballot feature church");
    userRepository = createDrizzleUserRepository(db, "Ballot feature church");
    await userRepository.insertUser({
      name: "Ada",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });
    adminCookie = await loginCookie(app, adminEmail, adminPassword);
    await app.close();
  });


  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    resetAuthAttempts();
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(candidates);
    await db.delete(rounds);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(roomRoster);
    await clearAuditEvents(db);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("records one anonymous ballot and a separate receipt, rejects a second vote, and elects above 50%", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoomWithCandidates(app, {
      title: "Eleição de presbítero",
      quorumValue: 2,
      candidates: ["Paulo", "Silas"],
    });
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;
    const silas = room.candidates.find((c) => c.displayName === "Silas")!;

    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);
    await join(app, room.inviteToken, "Caio", caioKey);

    const opened = await openRound(app, room.id);
    expect(opened.statusCode).toBe(201);
    const roundId = opened.json().round.id as string;

    const beforeReceipt = await checkReceipt(app, room.inviteToken, anaKey);
    expect(beforeReceipt.json()).toEqual({ roundId, hasVoted: false });

    const firstVote = await castVote(app, room.inviteToken, anaKey, paulo.id);
    expect(firstVote.statusCode).toBe(201);
    expect(firstVote.json()).toEqual({
      receipt: { roundId, roundNumber: 1, voted: true },
    });
    expect(firstVote.body).not.toContain(paulo.id);
    expect(firstVote.body).not.toContain(anaKey);

    const afterReceipt = await checkReceipt(app, room.inviteToken, anaKey);
    expect(afterReceipt.json()).toEqual({ roundId, hasVoted: true });

    const midRoundBallotState = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(midRoundBallotState.statusCode).toBe(200);
    expect(midRoundBallotState.json().round).toEqual({
      id: roundId,
      number: 1,
      status: "open",
      outcome: null,
    });
    expect(midRoundBallotState.json().round.tally).toBeUndefined();

    const duplicateVote = await castVote(app, room.inviteToken, anaKey, silas.id);
    expect(duplicateVote.statusCode).toBe(409);
    expect(duplicateVote.json()).toEqual({ error: "already_voted" });

    const secondVote = await castVote(app, room.inviteToken, biaKey, silas.id);
    expect(secondVote.statusCode).toBe(201);

    const thirdVote = await castVote(app, room.inviteToken, caioKey, paulo.id);
    expect(thirdVote.statusCode).toBe(201);

    const storedBallots = await db.select().from(ballots);
    const storedReceipts = await db.select().from(voteReceipts);
    expect(storedBallots).toHaveLength(3);
    expect(storedReceipts).toHaveLength(3);
    for (const ballot of storedBallots) {
      expect(ballot).not.toHaveProperty("participantId");
      expect(ballot).not.toHaveProperty("participant_id");
    }
    for (const receipt of storedReceipts) {
      expect(receipt).not.toHaveProperty("candidateId");
      expect(receipt).not.toHaveProperty("candidate_id");
    }
    const serializedBallots = JSON.stringify(storedBallots);
    expect(serializedBallots).not.toContain("Ana");
    expect(serializedBallots).not.toContain("Bia");
    expect(serializedBallots).not.toContain(anaKey);
    const serializedReceipts = JSON.stringify(storedReceipts);
    expect(serializedReceipts).not.toContain(paulo.id);
    expect(serializedReceipts).not.toContain(silas.id);

    const closed = await closeRound(app, room.id, roundId);
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({
      round: {
        id: roundId,
        number: 1,
        status: "closed",
        outcome: "elected",
        tally: {
          totalVotes: 3,
          nullVotes: 0,
          threshold: 2,
          outcome: "elected",
          winnerId: paulo.id,
          winnerName: "Paulo",
          standings: [
            { candidateId: paulo.id, displayName: "Paulo", votes: 2 },
            { candidateId: silas.id, displayName: "Silas", votes: 1 },
          ],
        },
      },
      quorum: { presentCount: 3, eligibleCount: 3, requiredCount: 2, quorumMet: true },
    });
    expect(closed.body).not.toContain("Ana");
    expect(closed.body).not.toContain("Bia");
    expect(closed.body).not.toContain("Caio");

    const voterState = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(voterState.statusCode).toBe(200);
    expect(voterState.json().round).toEqual(closed.json().round);
    expect(voterState.body).not.toContain("Ana");

    const published = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/publish`,
      headers: { cookie: adminCookie },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toEqual({ published: true, roundId, outcome: "elected" });

    await app.close();
  });


  it("marks outcome as no_majority when two voters split their votes 1 to 1", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoomWithCandidates(app, {
      title: "Assembleia empatada",
      quorumValue: 2,
      candidates: ["Barnabé", "Paulo"],
    });
    const barnabe = room.candidates.find((c) => c.displayName === "Barnabé")!;
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;

    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);

    const opened = await openRound(app, room.id);
    const roundId = opened.json().round.id as string;

    expect((await castVote(app, room.inviteToken, anaKey, paulo.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, biaKey, barnabe.id)).statusCode).toBe(201);

    const closed = await closeRound(app, room.id, roundId);
    expect(closed.statusCode).toBe(200);
    expect(closed.json().round).toEqual({
      id: roundId,
      number: 1,
      status: "closed",
      outcome: "no_majority",
      tally: {
        totalVotes: 2,
        nullVotes: 0,
        threshold: 2,
        outcome: "no_majority",
        winnerId: null,
        winnerName: null,
        standings: [
          { candidateId: barnabe.id, displayName: "Barnabé", votes: 1 },
          { candidateId: paulo.id, displayName: "Paulo", votes: 1 },
        ],
      },
    });

    const published = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/publish`,
      headers: { cookie: adminCookie },
    });
    expect(published.statusCode).toBe(409);
    expect(published.json()).toEqual({ error: "winner_not_elected" });

    await app.close();
  });


  it("rejects ballots from non-joined participants, closed rounds, or cross-room candidates", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoomWithCandidates(app, {
      title: "Sala A",
      quorumValue: 1,
      candidates: ["Paulo"],
    });
    const otherRoom = await createRoomWithCandidates(app, {
      title: "Sala B",
      quorumValue: 1,
      candidates: ["Silas"],
    });
    const paulo = room.candidates[0]!;
    const silasFromOtherRoom = otherRoom.candidates[0]!;

    await join(app, room.inviteToken, "Ana", anaKey);

    const beforeRound = await castVote(app, room.inviteToken, anaKey, paulo.id);
    expect(beforeRound.statusCode).toBe(409);
    expect(beforeRound.json()).toEqual({ error: "round_not_open" });

    const opened = await openRound(app, room.id);
    const roundId = opened.json().round.id as string;

    const unjoined = await castVote(app, room.inviteToken, "unjoined-key-9999", paulo.id);
    expect(unjoined.statusCode).toBe(403);
    expect(unjoined.json()).toEqual({ error: "participant_not_present" });

    const crossRoomCandidate = await castVote(
      app,
      room.inviteToken,
      anaKey,
      silasFromOtherRoom.id,
    );
    expect(crossRoomCandidate.statusCode).toBe(400);
    expect(crossRoomCandidate.json()).toEqual({ error: "invalid_candidate" });

    await db.update(participants).set({ isPresent: false });
    const closed = await closeRound(app, room.id, roundId);
    expect(closed.statusCode).toBe(200);
    const afterClose = await castVote(app, room.inviteToken, anaKey, paulo.id);
    expect(afterClose.statusCode).toBe(409);
    expect(afterClose.json()).toEqual({ error: "round_not_open" });

    expect(await db.select().from(ballots)).toEqual([]);
    expect(await db.select().from(voteReceipts)).toEqual([]);

    await app.close();
  });


  it("blocks closing with pending voters unless confirmed, keeps valid ballots when a voter is removed, and guarantees ballot secrecy columns cannot link to receipts", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoomWithCandidates(app, {
      title: "Assembleia com voto nulo e pendentes",
      quorumValue: 2,
      candidates: ["Paulo", "Barnabé"],
    });
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;
    const barnabe = room.candidates.find((c) => c.displayName === "Barnabé")!;

    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);
    await join(app, room.inviteToken, "Caio", caioKey);

    const opened = await openRound(app, room.id);
    const roundId = opened.json().round.id as string;

    // 2 of 3 present voted -> closing without confirmation fails with voting_incomplete
    expect((await castVote(app, room.inviteToken, anaKey, paulo.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, biaKey, barnabe.id)).statusCode).toBe(201);

    const incompleteClose = await closeRound(app, room.id, roundId);
    expect(incompleteClose.statusCode).toBe(409);
    expect(incompleteClose.json()).toEqual({
      error: "voting_incomplete",
      votedCount: 2,
      presentCount: 3,
    });

    // Caio casts a null/blank vote -> 3 of 3 present voted -> 1 Paulo, 1 Barnabé, 1 null -> no_majority (threshold 2)
    expect((await castVote(app, room.inviteToken, caioKey, null)).statusCode).toBe(201);

    const validClose = await closeRound(app, room.id, roundId);
    expect(validClose.statusCode).toBe(200);
    expect(validClose.json().round).toEqual({
      id: roundId,
      number: 1,
      status: "closed",
      outcome: "no_majority",
      tally: {
        totalVotes: 3,
        nullVotes: 1,
        threshold: 2,
        outcome: "no_majority",
        winnerId: null,
        winnerName: null,
        standings: [
          { candidateId: barnabe.id, displayName: "Barnabé", votes: 1 },
          { candidateId: paulo.id, displayName: "Paulo", votes: 1 },
        ],
      },
    });

    // Round 2: closing with pending voters when confirmPending=true records didNotVoteCount and calculates majority on cast ballots only
    const round2 = await openRound(app, room.id);
    const round2Id = round2.json().round.id as string;
    expect((await castVote(app, room.inviteToken, anaKey, paulo.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, biaKey, paulo.id)).statusCode).toBe(201);
    // Caio is present (presentCount = 3) but did not vote (totalVotes = 2)

    const confirmedPendingClose = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round2Id}/close`,
      headers: { cookie: adminCookie },
      payload: { confirmPending: true },
    });
    expect(confirmedPendingClose.statusCode).toBe(200);
    expect(confirmedPendingClose.json().round).toEqual({
      id: round2Id,
      number: 2,
      status: "closed",
      outcome: "elected",
      tally: {
        totalVotes: 2,
        nullVotes: 0,
        threshold: 2,
        outcome: "elected",
        winnerId: paulo.id,
        winnerName: "Paulo",
        didNotVoteCount: 1,
        standings: [
          { candidateId: paulo.id, displayName: "Paulo", votes: 2 },
          { candidateId: barnabe.id, displayName: "Barnabé", votes: 0 },
        ],
      },
    });

    // Subsequent voter ballot poll and admin room detail poll must also retain didNotVoteCount
    const voterPollAfterPendingClose = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(voterPollAfterPendingClose.statusCode).toBe(200);
    expect(voterPollAfterPendingClose.json().round.tally.didNotVoteCount).toBe(1);

    const adminDetailAfterPendingClose = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(adminDetailAfterPendingClose.statusCode).toBe(200);
    expect(adminDetailAfterPendingClose.json().room.round.tally.didNotVoteCount).toBe(1);

    // Decline Round 2 so we can test Round 3 where a voter who already voted is removed
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round2Id}/decline`,
      headers: { cookie: adminCookie },
    });

    // Round 3: all 3 vote for Barnabé, then Caio is removed (presentCount drops to 2 while 3 ballots exist) -> close succeeds without vote_count_mismatch
    const round3 = await openRound(app, room.id);
    const round3Id = round3.json().round.id as string;
    expect((await castVote(app, room.inviteToken, anaKey, barnabe.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, biaKey, barnabe.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, caioKey, barnabe.id)).statusCode).toBe(201);

    const participantRows = await db
      .select()
      .from(participants)
      .where(eq(participants.roomId, room.id));
    await db
      .update(participants)
      .set({ isPresent: false })
      .where(eq(participants.id, participantRows[0]!.id));

    const removedVoterClose = await closeRound(app, room.id, round3Id);
    expect(removedVoterClose.statusCode).toBe(200);
    expect(removedVoterClose.json().round.outcome).toBe("elected");
    expect(removedVoterClose.json().round.tally.totalVotes).toBe(3);

    // T0.5 Secrecy invariant: ballots rows only have id, roundId, candidateId (no createdAt, no ballotToken) and ballot_cast audit events have no fingerprints
    const allBallotRows = await db.select().from(ballots);
    expect(allBallotRows.length).toBeGreaterThan(0);
    for (const ballot of allBallotRows) {
      expect(Object.keys(ballot).sort()).toEqual(["candidateId", "id", "roundId"]);
    }

    const castAuditRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "ballot_cast"));
    expect(castAuditRows.length).toBeGreaterThan(0);
    for (const event of castAuditRows) {
      expect(event.payload).not.toHaveProperty("sessionFingerprint");
      expect(event.payload).not.toHaveProperty("receiptFingerprint");
    }

    await app.close();
  });


  it("serializes concurrent castBallot and closeRound so no ballot is orphaned outside the closed tally", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoomWithCandidates(app, {
      title: "Corrida entre voto e fechamento",
      quorumValue: 1,
      candidates: ["Paulo", "Silas"],
    });
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;

    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);

    const opened = await openRound(app, room.id);
    const roundId = opened.json().round.id as string;

    expect((await castVote(app, room.inviteToken, anaKey, paulo.id)).statusCode).toBe(201);

    // Fire Bia's vote and round close with confirmPending concurrently
    const [voteRes, closeRes] = await Promise.all([
      castVote(app, room.inviteToken, biaKey, paulo.id),
      app.inject({
        method: "POST",
        url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
        headers: { cookie: adminCookie },
        payload: { confirmPending: true },
      }),
    ]);

    expect(closeRes.statusCode).toBe(200);
    const closedTallyTotal = closeRes.json().round.tally.totalVotes as number;
    const storedRoundBallots = await db
      .select()
      .from(ballots)
      .where(eq(ballots.roundId, roundId));

    // Whether the vote landed before or after the lock, the closed tally totalVotes must match the stored ballot count
    if (voteRes.statusCode === 201) {
      expect(storedRoundBallots).toHaveLength(2);
      expect(closedTallyTotal).toBe(2);
    } else {
      expect(voteRes.statusCode).toBe(409);
      expect(storedRoundBallots).toHaveLength(1);
      expect(closedTallyTotal).toBe(1);
    }

    await app.close();
  });


  it("rate limits ballot spam per voter without blocking other voters on the same IP", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoomWithCandidates(app, {
      title: "Rate limit",
      quorumValue: 2,
      candidates: ["Paulo"],
    });
    const paulo = room.candidates[0]!;
    await join(app, room.inviteToken, "Ana", anaKey);
    await join(app, room.inviteToken, "Bia", biaKey);
    await openRound(app, room.id);

    for (let attempt = 0; attempt < BALLOT_RATE_LIMIT.limit; attempt += 1) {
      const response = await castVote(app, room.inviteToken, anaKey, paulo.id);
      expect(response.statusCode).toBe(attempt === 0 ? 201 : 409);
    }

    const limited = await castVote(app, room.inviteToken, anaKey, paulo.id);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("rate_limited");

    const otherVoter = await castVote(app, room.inviteToken, biaKey, paulo.id);
    expect(otherVoter.statusCode).toBe(201);

    await app.close();
  });

  async function createRoomWithCandidates(
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
