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
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-runoff@feature.test";
const adminPassword = "feature-admin-password";
const voterOneKey = "join-key-voter-0001";
const voterTwoKey = "join-key-voter-0002";
const voterThreeKey = "join-key-voter-0003";

describe("multi-round and runoff elections", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Runoff feature church");
    userRepository = createDrizzleUserRepository(db, "Runoff feature church");
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
    await db.delete(auditEvents);
    await db.delete(rooms);
  });

  it("runs ipb_society_board through 2 failed rounds into a 3rd-round top-2 runoff without carrying prior votes", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, {
      title: "Diretoria UPA — Presidente",
      roomType: "upa_board",
      rulesPreset: "ipb_society_board",
      quorumValue: 2,
      candidates: ["Ana", "Bia", "Caio"],
    });
    const ana = room.candidates.find((c) => c.displayName === "Ana")!;
    const bia = room.candidates.find((c) => c.displayName === "Bia")!;
    const caio = room.candidates.find((c) => c.displayName === "Caio")!;

    await join(app, room.inviteToken, "Votante 1", voterOneKey);
    await join(app, room.inviteToken, "Votante 2", voterTwoKey);
    await join(app, room.inviteToken, "Votante 3", voterThreeKey);

    // Round 1: 1-1-1 split -> no majority
    const openR1 = await openRound(app, room.id);
    expect(openR1.statusCode).toBe(201);
    const round1Id = openR1.json().round.id as string;
    expect(openR1.json().candidates).toHaveLength(3);

    expect((await castVote(app, room.inviteToken, voterOneKey, ana.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, voterTwoKey, bia.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, voterThreeKey, caio.id)).statusCode).toBe(201);

    const closeR1 = await closeRound(app, room.id, round1Id);
    expect(closeR1.statusCode).toBe(200);
    expect(closeR1.json().round.outcome).toBe("no_majority");
    expect(closeR1.json().round.tally.totalVotes).toBe(3);

    // Round 2: all 3 candidates remain eligible; one-vote-per-person resets; prior ballots do not carry over
    const openR2 = await openRound(app, room.id);
    expect(openR2.statusCode).toBe(201);
    const round2Id = openR2.json().round.id as string;
    expect(openR2.json().round.number).toBe(2);
    expect(openR2.json().candidates.map((c: { displayName: string }) => c.displayName)).toEqual([
      "Ana",
      "Bia",
      "Caio",
    ]);

    const receiptStartR2 = await checkReceipt(app, room.inviteToken, voterOneKey);
    expect(receiptStartR2.json()).toEqual({ roundId: round2Id, hasVoted: false });

    // In Round 2, Voter 1 (Ana), Voter 2 (Bia), and Voter 3 (null) cast votes -> no majority, Ana & Bia are top 2
    expect((await castVote(app, room.inviteToken, voterOneKey, ana.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, voterTwoKey, bia.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, voterThreeKey, null)).statusCode).toBe(201);

    const closeR2 = await closeRound(app, room.id, round2Id);
    expect(closeR2.statusCode).toBe(200);
    expect(closeR2.json().round).toMatchObject({
      id: round2Id,
      number: 2,
      status: "closed",
      outcome: "no_majority",
      tally: {
        totalVotes: 3,
        nullVotes: 1,
        threshold: 2,
        outcome: "no_majority",
        standings: [
          { candidateId: ana.id, displayName: "Ana", votes: 1 },
          { candidateId: bia.id, displayName: "Bia", votes: 1 },
          { candidateId: caio.id, displayName: "Caio", votes: 0 },
        ],
      },
    });

    // Reject invalid manual subset on ipb_society_board after round 2
    const badSubset = await openRound(app, room.id, { candidateIds: [ana.id, caio.id] });
    expect(badSubset.statusCode).toBe(400);
    expect(badSubset.json()).toEqual({ error: "invalid_candidate_subset" });

    // Round 3: automatically narrows to top 2 (Ana and Bia); Caio is eliminated
    const openR3 = await openRound(app, room.id);
    expect(openR3.statusCode).toBe(201);
    const round3Id = openR3.json().round.id as string;
    expect(openR3.json().round.number).toBe(3);
    expect(openR3.json().candidates).toEqual([
      { id: ana.id, displayName: "Ana" },
      { id: bia.id, displayName: "Bia" },
    ]);

    const ballotStateR3 = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotStateR3.statusCode).toBe(200);
    expect(ballotStateR3.json().candidates).toEqual([
      { id: ana.id, displayName: "Ana", photoUrl: null },
      { id: bia.id, displayName: "Bia", photoUrl: null },
    ]);

    // Voting for eliminated candidate Caio in Round 3 is rejected
    const eliminatedVote = await castVote(app, room.inviteToken, voterThreeKey, caio.id);
    expect(eliminatedVote.statusCode).toBe(400);
    expect(eliminatedVote.json()).toEqual({ error: "invalid_candidate" });

    // All 3 voters can vote in Round 3 (2 for Ana, 1 for Bia)
    expect((await castVote(app, room.inviteToken, voterOneKey, ana.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, voterTwoKey, bia.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, voterThreeKey, ana.id)).statusCode).toBe(201);

    // Round 3 ballots only contain the 3 votes from Round 3 (prior 5 ballots do not carry in)
    const round3Ballots = await db.select().from(ballots).where(eq(ballots.roundId, round3Id));
    expect(round3Ballots).toHaveLength(3);

    const closeR3 = await closeRound(app, room.id, round3Id);
    expect(closeR3.statusCode).toBe(200);
    expect(closeR3.json().round).toEqual({
      id: round3Id,
      number: 3,
      officeLabel: "Presidente",
      officeRoundNumber: 3,
      status: "closed",
      outcome: "elected",
      tally: {
        totalVotes: 3,
        nullVotes: 0,
        threshold: 2,
        outcome: "elected",
        winnerId: ana.id,
        winnerName: "Ana",
        standings: [
          { candidateId: ana.id, displayName: "Ana", votes: 2 },
          { candidateId: bia.id, displayName: "Bia", votes: 1 },
        ],
      },
    });

    // Cannot open another round for Presidente once Presidente is elected
    const openR4 = await openRound(app, room.id, { officeLabel: "Presidente" });
    expect(openR4.statusCode).toBe(409);
    expect(openR4.json()).toEqual({ error: "winner_already_elected" });

    await app.close();
  });

  it("limits ipb_local_officers after 2nd round without majority to most voted or admin-chosen subset", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, {
      title: "Eleição de Presbítero",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 2,
      candidates: ["Davi", "Elias", "Filipe"],
    });
    const davi = room.candidates.find((c) => c.displayName === "Davi")!;
    const elias = room.candidates.find((c) => c.displayName === "Elias")!;
    const filipe = room.candidates.find((c) => c.displayName === "Filipe")!;

    await join(app, room.inviteToken, "Votante 1", voterOneKey);
    await join(app, room.inviteToken, "Votante 2", voterTwoKey);

    // Round 1: Davi 1, Elias 1, Filipe 0 -> no majority
    const openR1 = await openRound(app, room.id);
    const round1Id = openR1.json().round.id as string;
    await castVote(app, room.inviteToken, voterOneKey, davi.id);
    await castVote(app, room.inviteToken, voterTwoKey, elias.id);
    await closeRound(app, room.id, round1Id);

    // Round 2: all 3 still eligible; Davi 1, Elias 1, Filipe 0 -> no majority
    const openR2 = await openRound(app, room.id);
    const round2Id = openR2.json().round.id as string;
    expect(openR2.json().candidates).toHaveLength(3);
    await castVote(app, room.inviteToken, voterOneKey, davi.id);
    await castVote(app, room.inviteToken, voterTwoKey, elias.id);
    await closeRound(app, room.id, round2Id);

    // Reject empty or malformed candidateIds
    const emptySubset = await openRound(app, room.id, { candidateIds: [] });
    expect(emptySubset.statusCode).toBe(400);
    expect(emptySubset.json()).toEqual({ error: "invalid_candidate_subset" });

    // Round 3: admin limits further ballots to most voted [Davi, Elias]
    const openR3 = await openRound(app, room.id, { candidateIds: [davi.id, elias.id] });
    expect(openR3.statusCode).toBe(201);
    const round3Id = openR3.json().round.id as string;
    expect(openR3.json().candidates).toEqual([
      { id: davi.id, displayName: "Davi" },
      { id: elias.id, displayName: "Elias" },
    ]);

    // Filipe is no longer eligible
    const filipeVote = await castVote(app, room.inviteToken, voterOneKey, filipe.id);
    expect(filipeVote.statusCode).toBe(400);
    expect(filipeVote.json()).toEqual({ error: "invalid_candidate" });

    // Both voters vote for Davi in Round 3
    expect((await castVote(app, room.inviteToken, voterOneKey, davi.id)).statusCode).toBe(201);
    expect((await castVote(app, room.inviteToken, voterTwoKey, davi.id)).statusCode).toBe(201);

    const closeR3 = await closeRound(app, room.id, round3Id);
    expect(closeR3.statusCode).toBe(200);
    expect(closeR3.json().round.outcome).toBe("elected");
    expect(closeR3.json().round.tally.winnerName).toBe("Davi");

    await app.close();
  });

  async function createRoom(
    app: Awaited<ReturnType<typeof buildApp>>,
    input: {
      title: string;
      roomType: "elder" | "upa_board";
      rulesPreset: "ipb_local_officers" | "ipb_society_board";
      quorumValue: number;
      candidates: string[];
    },
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: input.title,
        roomType: input.roomType,
        rulesPreset: input.rulesPreset,
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

  function openRound(
    app: Awaited<ReturnType<typeof buildApp>>,
    roomId: string,
    payload?: { candidateIds: string[] },
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/rounds`,
      headers: { cookie: adminCookie },
      ...(payload ? { payload } : {}),
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
