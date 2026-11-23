import {
  ballotMarks,
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
  roomEntryRequests,
  roomMemberCodes,
  roomRoster,
  rooms,
  roundPaperTallies,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { resetAuthAttempts } from "./auth/auth-attempts.js";
import { hashPassword } from "./auth/password.js";
import { createDrizzleRoomRepository } from "./rooms/drizzle-room-repository.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import { resetRateLimits } from "./security/rate-limiter.js";
import { clearAuditEvents } from "./testing/database.js";
import { createDrizzleUserRepository } from "./users/drizzle-user-repository.js";
import type { UserRepository } from "./users/user-repository.js";

const adminEmail = "ada-multivac@feature.test";
const adminPassword = "feature-admin-password";

describe("T5.2 & T5.4 — multi-vacancy officer elections, ballot_marks anonymity, and paper tallies", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Multi-vacancy church");
    userRepository = createDrizzleUserRepository(db, "Multi-vacancy church");

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
    resetRateLimits();
    await db.delete(ballotMarks);
    await db.delete(roundPaperTallies);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(roomEntryRequests);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(roomRoster);
    await clearAuditEvents(db);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("T5.2: runs a 5-vacancy Deacon election across 3 scrutinies (2 + 2 + 1 elected), validates marks, and preserves ballot_marks anonymity", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const candidateNames = [
      "Diác. Abraão",
      "Diác. Barnabé",
      "Diác. Calebe",
      "Diác. Daniel",
      "Diác. Estêvão",
      "Diác. Filipe",
      "Diác. Gideão",
    ];
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição de 5 Diáconos",
        roomType: "deacon",
        rulesPreset: "ipb_local_officers",
        quorumValue: 3,
        quorumUnit: "absolute",
        status: "test",
        vacancies: 5,
        candidates: candidateNames,
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      vacancies: number;
      candidates: Array<{ id: string; displayName: string }>;
    };
    expect(room.vacancies).toBe(5);

    const byName = new Map(room.candidates.map((c) => [c.displayName, c.id]));
    const [c1, c2, c3, c4, c5, c6, c7] = candidateNames.map((n) => byName.get(n)!);

    // Join 4 simulated voters
    const simCodes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 4 },
    });
    const codes = simCodes.json().accessCodes as Array<{ code: string }>;
    const voterKeys = [
      "join-key-deacon-voter-0001",
      "join-key-deacon-voter-0002",
      "join-key-deacon-voter-0003",
      "join-key-deacon-voter-0004",
    ];
    for (let i = 0; i < 4; i += 1) {
      const joined = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}`,
        payload: { code: codes[i]!.code, joinKey: voterKeys[i]! },
      });
      expect(joined.statusCode).toBe(200);
    }

    // Open Scrutiny 1 -> automatically 5 vacancies
    const round1Res = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(round1Res.statusCode).toBe(201);
    const round1 = round1Res.json().round as { id: string; vacancies: number };
    expect(round1.vacancies).toBe(5);

    // Vacancies cannot be changed once round 1 is open
    const lockedVacancies = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { vacancies: 4 },
    });
    expect(lockedVacancies.statusCode).toBe(409);
    expect(lockedVacancies.json().error).toBe("vacancies_locked_after_round");

    // Validation: > 5 marks rejected
    const tooMany = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voterKeys[0]!, candidateIds: [c1!, c2!, c3!, c4!, c5!, c6!] },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error).toBe("too_many_marks");

    // Validation: duplicate candidate mark rejected
    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voterKeys[0]!, candidateIds: [c1!, c1!] },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error).toBe("duplicate_candidate_mark");

    // Cast 4 ballots in Scrutiny 1 (majority threshold = floor(4/2)+1 = 3):
    // V1 marks 5: c1, c2, c3, c4, c5
    // V2 marks 3 (< N): c1, c2, c3
    // V3 marks 2 (< N): c1, c2
    // V4 votes blank: []
    // Totals: c1=3 (elected), c2=3 (elected), c3=2, c4=1, c5=1, c6=0, c7=0, blank=1
    for (const [idx, marks] of [
      [0, [c1!, c2!, c3!, c4!, c5!]],
      [1, [c1!, c2!, c3!]],
      [2, [c1!, c2!]],
      [3, []],
    ] as Array<[number, string[]]>) {
      const vote = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey: voterKeys[idx]!, candidateIds: marks },
      });
      expect(vote.statusCode).toBe(201);
    }

    // Secrecy invariant: verify ballot_marks has ONLY id, ballotId, candidateId (no participant/timestamp)
    const r1Ballots = await db.select().from(ballots).where(eq(ballots.roundId, round1.id));
    expect(r1Ballots).toHaveLength(4);
    const r1Marks = await db.select().from(ballotMarks);
    expect(r1Marks).toHaveLength(10); // 5 + 3 + 2 + 0
    for (const mark of r1Marks) {
      expect(Object.keys(mark).sort()).toEqual(["ballotId", "candidateId", "id"]);
    }

    // Close Scrutiny 1 -> 2 elected (c1, c2), 3 remaining vacancies
    const close1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round1.id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close1.statusCode).toBe(200);
    expect(close1.json().round).toMatchObject({
      outcome: "elected",
      vacancies: 5,
      winnerCandidateIds: expect.arrayContaining([c1!, c2!]),
      tally: expect.objectContaining({
        totalVotes: 4,
        threshold: 3,
        vacancies: 5,
        remainingVacancies: 3,
        partialElection: true,
      }),
    });
    expect(close1.json().round.winnerCandidateIds).toHaveLength(2);

    // Open Scrutiny 2 -> auto-computes 3 remaining vacancies and excludes c1, c2
    const round2Res = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(round2Res.statusCode).toBe(201);
    const round2 = round2Res.json().round as { id: string; vacancies: number };
    expect(round2.vacancies).toBe(3);
    const r2CandidateIds = (round2Res.json().candidates as Array<{ id: string }>).map((c) => c.id);
    expect(r2CandidateIds).not.toContain(c1);
    expect(r2CandidateIds).not.toContain(c2);
    expect(r2CandidateIds).toHaveLength(5);

    // Voting for already-elected c1 in Scrutiny 2 is rejected as invalid_candidate
    const voteAlreadyElected = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voterKeys[0]!, candidateIds: [c1!] },
    });
    expect(voteAlreadyElected.statusCode).toBe(400);
    expect(voteAlreadyElected.json().error).toBe("invalid_candidate");

    // Scrutiny 2 votes: c3 and c4 reach 3/4 -> 2 more elected, 1 remaining
    for (const [idx, marks] of [
      [0, [c3!, c4!, c5!]],
      [1, [c3!, c4!, c6!]],
      [2, [c3!, c4!]],
      [3, [c5!, c7!]],
    ] as Array<[number, string[]]>) {
      const vote = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey: voterKeys[idx]!, candidateIds: marks },
      });
      expect(vote.statusCode).toBe(201);
    }

    const close2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round2.id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close2.statusCode).toBe(200);
    expect(close2.json().round.tally.winnerIds).toHaveLength(2);
    expect(close2.json().round.tally.winnerIds).toEqual(expect.arrayContaining([c3!, c4!]));
    expect(close2.json().round.tally.remainingVacancies).toBe(1);

    // Open Scrutiny 3 -> auto-computes 1 remaining vacancy and excludes c1..c4
    const round3Res = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(round3Res.statusCode).toBe(201);
    const round3 = round3Res.json().round as { id: string; vacancies: number };
    expect(round3.vacancies).toBe(1);
    const r3CandidateIds = (round3Res.json().candidates as Array<{ id: string }>).map((c) => c.id);
    expect(r3CandidateIds.sort()).toEqual([c5!, c6!, c7!].sort());

    // Scrutiny 3 votes: c5 gets 3/4 -> final 5th deacon elected
    for (const [idx, marks] of [
      [0, [c5!]],
      [1, [c5!]],
      [2, [c5!]],
      [3, [c6!]],
    ] as Array<[number, string[]]>) {
      const vote = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey: voterKeys[idx]!, candidateIds: marks },
      });
      expect(vote.statusCode).toBe(201);
    }

    const close3 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round3.id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close3.statusCode).toBe(200);
    expect(close3.json().round.tally.winnerIds).toEqual([c5!]);
    expect(close3.json().round.tally.remainingVacancies).toBe(0);

    // Room detail & voter ballot expose all 5 cumulative electedCandidates & remainingVacancies = 0
    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().room.remainingVacancies).toBe(0);
    expect(detail.json().room.electedCandidates).toHaveLength(5);

    const voterBallot = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
      headers: { "x-scelta-join-key": voterKeys[0]! },
    });
    expect(voterBallot.statusCode).toBe(200);
    expect(voterBallot.json().vacancies).toBe(5);
    expect(voterBallot.json().remainingVacancies).toBe(0);
    expect(voterBallot.json().electedCandidates).toHaveLength(5);

    // Trying to open a 4th scrutiny fails with 409 winner_already_elected
    const round4Res = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(round4Res.statusCode).toBe(409);
    expect(round4Res.json().error).toBe("winner_already_elected");

    await app.close();
  });

  it("T5.2: restricts runoff exclusively to last-vacancy tied candidates and allows closing room with open vacancies", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const names = ["Presb. A", "Presb. B", "Presb. C", "Presb. D", "Presb. E"];
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição de 3 Presbíteros",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 4,
        quorumUnit: "absolute",
        status: "test",
        vacancies: 3,
        candidates: names,
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };
    const byName = new Map(room.candidates.map((c) => [c.displayName, c.id]));
    const [a, b, c, d, e] = names.map((n) => byName.get(n)!);

    const simCodes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 4 },
    });
    const codes = simCodes.json().accessCodes as Array<{ code: string }>;
    const voterKeys = [
      "join-key-elder-tie-0001",
      "join-key-elder-tie-0002",
      "join-key-elder-tie-0003",
      "join-key-elder-tie-0004",
    ];
    for (let i = 0; i < 4; i += 1) {
      await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}`,
        payload: { code: codes[i]!.code, joinKey: voterKeys[i]! },
      });
    }

    const r1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    const r1Id = r1.json().round.id as string;

    // 4 ballots (threshold = 3), 3 vacancies:
    // A = 4 votes (strictly above cutoff -> elected!)
    // B = 3, C = 3, D = 3 (3-way tie for remaining 2 vacancies!)
    // E = 0
    // Wait: each ballot can have at most 3 marks -> 4*3 = 12 marks total:
    // Actually let's give A=4, B=3, C=3, D=3? 4+3+3+3 = 13 > 12!
    // Use 4 ballots with 3 vacancies:
    // Wait: if 4 voters vote for [A, B, C], [A, B, D], [A, C, D], [B, C, D] -> A=3, B=3, C=3, D=3 (4-way tie for 3 vacancies -> 0 elected, all 4 tied!)
    // Or 5 voters (threshold = 3): A=5, B=3, C=3, D=3 (5+3+3+3=14 <= 15 marks)!
    // Let's do A=3, B=3, C=3, D=3 with 4 voters -> 4-way tie at cutoff (0 elected, 3 remaining, lastVacancyTieCandidateIds = [A, B, C, D], E excluded)!
    for (const [idx, marks] of [
      [0, [a!, b!, c!]],
      [1, [a!, b!, d!]],
      [2, [a!, c!, d!]],
      [3, [b!, c!, d!]],
    ] as Array<[number, string[]]>) {
      const vote = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey: voterKeys[idx]!, candidateIds: marks },
      });
      expect(vote.statusCode).toBe(201);
    }

    const close1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r1Id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close1.statusCode).toBe(200);
    expect(close1.json().round.outcome).toBe("no_majority");
    expect(close1.json().round.tally.lastVacancyTieCandidateIds.sort()).toEqual(
      [a!, b!, c!, d!].sort(),
    );

    // Opening Scrutiny 2 restricts strictly to the 4 tied candidates (excluding E!)
    const r2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(r2.statusCode).toBe(201);
    const r2CandidateIds = (r2.json().candidates as Array<{ id: string }>).map((item) => item.id);
    expect(r2CandidateIds.sort()).toEqual([a!, b!, c!, d!].sort());
    expect(r2CandidateIds).not.toContain(e);

    // Elect only A in Scrutiny 2 (1 of 3), then desk chooses to close the room with 2 open vacancies
    const r2Id = r2.json().round.id as string;
    for (const [idx, marks] of [
      [0, [a!]],
      [1, [a!]],
      [2, [a!]],
      [3, []],
    ] as Array<[number, string[]]>) {
      await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey: voterKeys[idx]!, candidateIds: marks },
      });
    }

    const close2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${r2Id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(close2.statusCode).toBe(200);
    expect(close2.json().round.tally.winnerIds).toEqual([a!]);
    expect(close2.json().round.tally.remainingVacancies).toBe(2);

    // Desk closes room with 2 vacancies left open
    const closeRoom = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { status: "closed" },
    });
    expect(closeRoom.statusCode).toBe(200);
    expect(closeRoom.json().room.status).toBe("closed");

    await app.close();
  });

  it("T5.4: validates multi-vacancy paper tallies (marks <= N * validBallots) and combines online + paper votes", async () => {
    await repository.createMember({
      fullName: "Membro Online 1",
      isCommunicant: true,
      isMale: true,
      birthDate: null,
    });
    await repository.createMember({
      fullName: "Membro Online 2",
      isCommunicant: true,
      isMale: true,
      birthDate: null,
    });
    await repository.createMember({
      fullName: "Membro Papel 1",
      isCommunicant: true,
      isMale: true,
      birthDate: null,
    });
    await repository.createMember({
      fullName: "Membro Papel 2",
      isCommunicant: true,
      isMale: true,
      birthDate: null,
    });

    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Diáconos Híbrido 3 Vagas",
        roomType: "deacon",
        rulesPreset: "ipb_local_officers",
        quorumValue: 2,
        quorumUnit: "absolute",
        status: "open",
        vacancies: 3,
        candidates: ["Cand 1", "Cand 2", "Cand 3", "Cand 4"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };
    const [c1, c2, c3, c4] = room.candidates.map((c) => c.id);

    // Mark 2 roster members as paper voters, generate codes for the 2 online voters
    const rosterRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    const rosterEntries = rosterRes.json().entries as Array<{ id: string; fullName: string }>;
    for (const entry of rosterEntries.filter((e) => e.fullName.startsWith("Membro Papel"))) {
      const paperRes = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rooms/${room.id}/roster/${entry.id}/paper-mode`,
        headers: { cookie: adminCookie },
        payload: { votesOnPaper: true },
      });
      expect(paperRes.statusCode).toBe(200);
    }

    const genRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    const activeCodes = (
      genRes.json().accessCodes as Array<{ code: string; revokedAt: string | null }>
    ).filter((c) => c.revokedAt === null);
    expect(activeCodes).toHaveLength(2);

    const onlineKeys = ["join-key-hybrid-online-0001", "join-key-hybrid-online-0002"];
    for (let i = 0; i < 2; i += 1) {
      const joined = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}`,
        payload: { code: activeCodes[i]!.code, joinKey: onlineKeys[i]! },
      });
      expect(joined.statusCode).toBe(200);
    }

    const roundRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(roundRes.statusCode).toBe(201);
    const roundId = roundRes.json().round.id as string;

    // 2 online ballots: both mark c1, c2, c3
    for (const key of onlineKeys) {
      const vote = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey: key, candidateIds: [c1!, c2!, c3!] },
      });
      expect(vote.statusCode).toBe(201);
    }

    // Paper tally validation: 2 valid paper ballots * 3 vacancies = max 6 marks.
    // Sending 7 marks (2+2+2+1) must fail with 400 paper_marks_exceed_ballots
    const tooManyPaperMarks = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 2,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { [c1!]: 2, [c2!]: 2, [c3!]: 2, [c4!]: 1 },
      },
    });
    expect(tooManyPaperMarks.statusCode).toBe(400);
    expect(tooManyPaperMarks.json().error).toBe("paper_marks_exceed_ballots");

    // Single candidate receiving 3 votes on 2 valid paper ballots must fail
    const singleCandExceeds = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 2,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { [c1!]: 3, [c2!]: 1, [c3!]: 0, [c4!]: 0 },
      },
    });
    expect(singleCandExceeds.statusCode).toBe(400);
    expect(singleCandExceeds.json().error).toBe("paper_marks_exceed_ballots");

    // Valid multi-vacancy paper tally: 2 valid paper ballots, 5 total marks (<= 6):
    // c1=2, c2=1, c3=0, c4=2 -> Combined (4 total ballots, threshold = 3):
    // c1 = 2+2 = 4 (elected), c2 = 2+1 = 3 (elected), c3 = 2+0 = 2 (not elected), c4 = 0+2 = 2 (not elected)
    const validPaper = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 2,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { [c1!]: 2, [c2!]: 1, [c3!]: 0, [c4!]: 2 },
      },
    });
    expect(validPaper.statusCode).toBe(200);

    const closed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
    expect(closed.statusCode).toBe(200);
    const tally = closed.json().round.tally;
    expect(tally.totalVotes).toBe(4);
    expect(tally.threshold).toBe(3);
    expect(tally.winnerIds.sort()).toEqual([c1!, c2!].sort());
    expect(tally.remainingVacancies).toBe(1);
    expect(tally.voteOrigin).toEqual({
      online: { ballots: 2, candidateVotes: 6, blankVotes: 0 },
      paper: { ballots: 2, candidateVotes: 5, blankVotes: 0, nullVotes: 0 },
    });

    await app.close();
  });

  it("rejects vacancies > 1 on society board (UPA/UMP) and pastor rooms", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const upaInvalid = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "UPA Inválida",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        vacancies: 3,
        candidates: ["Jovem A", "Jovem B"],
      },
    });
    expect(upaInvalid.statusCode).toBe(400);
    expect(upaInvalid.json().details).toContainEqual({ field: "vacancies", code: "invalid" });

    const upaValid = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "UPA Diretoria",
        roomType: "upa_board",
        rulesPreset: "ipb_society_board",
        candidates: ["Jovem A", "Jovem B"],
      },
    });
    expect(upaValid.statusCode).toBe(201);
    expect(upaValid.json().room.vacancies).toBe(1);

    const patchUpa = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${upaValid.json().room.id}`,
      headers: { cookie: adminCookie },
      payload: { vacancies: 2 },
    });
    expect(patchUpa.statusCode).toBe(400);

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
  const raw = response.headers["set-cookie"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  expect(first).toBeDefined();
  return first!.split(";")[0]!;
}
