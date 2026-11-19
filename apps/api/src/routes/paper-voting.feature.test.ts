import {
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
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
import { buildApp } from "../app.js";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import type { PresenceSnapshot } from "../realtime.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { clearAuditEvents } from "../testing/database.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-paper@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-paper@feature.test";
const memberPassword = "feature-member-password";

describe("Etapa 3: paper voting (T3.1, T3.2, T3.3)", () => {
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
    repository = createDrizzleRoomRepository(db, "Paper feature church");
    userRepository = createDrizzleUserRepository(db, "Paper feature church");
    await userRepository.insertUser({
      name: "Ada Admin",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });
    await userRepository.insertUser({
      name: "Mia Member",
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
    await db.delete(roundPaperTallies);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(roomRoster);
    await db.delete(members);
    await db.delete(rooms);
  });

  it("T3.1: marks voter as paper (revokes code, expels session while keeping past votes, counts in quorum, excludes from online pending) and undoes paper mode", async () => {
    const presenceEvents: PresenceSnapshot[] = [];
    const app = await buildApp({
      roomRepository: repository,
      userRepository,
      presencePublisher: {
        publishPresence(_roomId, presence) {
          presenceEvents.push(presence);
        },
      },
    });

    for (const name of ["Ana", "Bia", "Caio", "Davi"]) {
      await repository.createMember({
        fullName: name,
        isCommunicant: true,
        isMale: true,
        birthDate: "1990-01-01",
      });
    }

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Assembleia Híbrida",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 2,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Ana", "Bia"],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const room = createRes.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };
    const anaCandidate = room.candidates.find((c) => c.displayName === "Ana")!;
    const biaCandidate = room.candidates.find((c) => c.displayName === "Bia")!;

    const codesRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    expect(codesRes.statusCode).toBe(200);

    const rosterRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    const entries = rosterRes.json().entries as Array<{
      id: string;
      fullName: string;
      votesOnPaper: boolean;
      accessCode: { id: string; code: string; revokedAt: string | null } | null;
      isPresent: boolean;
    }>;
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.votesOnPaper === false)).toBe(true);

    const anaEntry = entries.find((e) => e.fullName === "Ana")!;
    const biaEntry = entries.find((e) => e.fullName === "Bia")!;

    // Ana joins online and casts a vote in round 1 (which later gets closed)
    const anaJoin = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: anaEntry.accessCode!.code, joinKey: "ana-online-key-0001" },
    });
    expect(anaJoin.statusCode).toBe(200);
    const biaJoin = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: biaEntry.accessCode!.code, joinKey: "bia-online-key-0002" },
    });
    expect(biaJoin.statusCode).toBe(200);

    const round1Res = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(round1Res.statusCode).toBe(201);
    const round1Id = round1Res.json().round.id as string;

    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "ana-online-key-0001", candidateId: anaCandidate.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "bia-online-key-0002", candidateId: biaCandidate.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round1Id}/close`,
      headers: { cookie: adminCookie },
    });

    // Unauthorized role cannot toggle paper mode
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/roster/${anaEntry.id}/paper-mode`,
      headers: { cookie: memberCookie },
      payload: { votesOnPaper: true },
    });
    expect(forbidden.statusCode).toBe(403);

    // Mark Ana as votesOnPaper: true
    presenceEvents.length = 0;
    const enablePaper = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/roster/${anaEntry.id}/paper-mode`,
      headers: { cookie: adminCookie },
      payload: { votesOnPaper: true },
    });
    expect(enablePaper.statusCode).toBe(200);
    expect(enablePaper.json()).toMatchObject({
      entry: {
        id: anaEntry.id,
        votesOnPaper: true,
        isPresent: false,
      },
      accessCode: null,
      presence: {
        presentCount: 2, // 1 online (Bia) + 1 paper (Ana)
        onlinePresentCount: 1,
        paperVotersCount: 1,
        eligibleCount: 4,
        requiredCount: 2,
        quorumMet: true,
      },
    });
    expect(enablePaper.json().entry.accessCode.revokedAt).toBeTruthy();
    expect(presenceEvents[0]).toMatchObject({
      presentCount: 2,
      onlinePresentCount: 1,
      paperVotersCount: 1,
      quorumMet: true,
    });

    // Ana's previous participant, vote_receipt, and ballot rows were NEVER deleted
    expect(await db.select().from(participants)).toHaveLength(2);
    expect(await db.select().from(voteReceipts)).toHaveLength(2);
    expect(await db.select().from(ballots)).toHaveLength(2);

    // Ana cannot rejoin with her revoked code
    const anaRejoin = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: anaEntry.accessCode!.code, joinKey: "ana-online-key-0009" },
    });
    expect(anaRejoin.statusCode).toBe(403);

    // Generating access codes does NOT issue a code for Ana while votesOnPaper is true
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    const anaCodes = await db
      .select()
      .from(roomMemberCodes)
      .where(eq(roomMemberCodes.rosterEntryId, anaEntry.id));
    expect(anaCodes.every((c) => c.revokedAt !== null)).toBe(true);

    // Open round 2: quorum is met (1 online + 1 paper = 2 >= 2), and only Bia votes online.
    // Closing with confirmNoPaperBallots: true succeeds WITHOUT voting_incomplete because Ana is NOT pending online!
    const round2Res = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(round2Res.statusCode).toBe(201);
    const round2Id = round2Res.json().round.id as string;

    const biaVote2 = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "bia-online-key-0002", candidateId: anaCandidate.id },
    });
    expect(biaVote2.statusCode).toBe(201);

    const blockedNoPaper = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round2Id}/close`,
      headers: { cookie: adminCookie },
    });
    expect(blockedNoPaper.statusCode).toBe(409);
    expect(blockedNoPaper.json()).toMatchObject({
      error: "paper_tally_required",
      paperVotersCount: 1,
    });

    const closeConfirmNoPaper = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${round2Id}/close`,
      headers: { cookie: adminCookie },
      payload: { confirmNoPaperBallots: true },
    });
    expect(closeConfirmNoPaper.statusCode).toBe(200);
    expect(closeConfirmNoPaper.json().round.tally).toMatchObject({
      didNotVoteCount: 1,
      winnerId: anaCandidate.id,
    });

    // Undo paper mode for Ana -> issues a new active access code & updates presence
    const disablePaper = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/roster/${anaEntry.id}/paper-mode`,
      headers: { cookie: adminCookie },
      payload: { votesOnPaper: false },
    });
    expect(disablePaper.statusCode).toBe(200);
    expect(disablePaper.json().entry.votesOnPaper).toBe(false);
    const newCode = disablePaper.json().accessCode.code as string;
    expect(newCode).toBeTruthy();
    expect(newCode).not.toBe(anaEntry.accessCode!.code);
    expect(disablePaper.json().presence).toMatchObject({
      presentCount: 1,
      onlinePresentCount: 1,
      paperVotersCount: 0,
      quorumMet: false,
    });

    // Ana can join with the newly issued code
    const anaRejoinNew = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: newCode, joinKey: "ana-online-key-0010" },
    });
    expect(anaRejoinNew.statusCode).toBe(200);

    // Audit trail recorded both transitions
    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    const actions = (auditRes.json().events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain("roster_paper_mode_enabled");
    expect(actions).toContain("roster_paper_mode_disabled");
    expect(auditRes.json().chainValid).toBe(true);

    // Closing the room blocks paper mode changes with 409 room_closed
    await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { status: "closed" },
    });
    const closedToggle = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/roster/${anaEntry.id}/paper-mode`,
      headers: { cookie: adminCookie },
      payload: { votesOnPaper: true },
    });
    expect(closedToggle.statusCode).toBe(409);
    expect(closedToggle.json()).toMatchObject({ error: "room_closed" });

    await app.close();
  });

  it("T3.2 & T3.3: validates paper tallies, enforces close-round guard, combines online + paper tallies, and exposes voteOrigin & audit provenance", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    for (const name of ["Paulo", "Silas", "Lucas", "Mateus", "Marcos"]) {
      await repository.createMember({
        fullName: name,
        isCommunicant: true,
        isMale: true,
        birthDate: "1990-01-01",
      });
    }

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição Com Urna de Papel",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 3,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Paulo", "Silas"],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const room = createRes.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };
    const paulo = room.candidates.find((c) => c.displayName === "Paulo")!;
    const silas = room.candidates.find((c) => c.displayName === "Silas")!;

    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    const rosterRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    const entries = rosterRes.json().entries as Array<{
      id: string;
      fullName: string;
      accessCode: { code: string } | null;
    }>;

    // 2 online voters (Paulo, Silas), 3 paper voters (Lucas, Mateus, Marcos)
    const pauloEntry = entries.find((e) => e.fullName === "Paulo")!;
    const silasEntry = entries.find((e) => e.fullName === "Silas")!;
    for (const name of ["Lucas", "Mateus", "Marcos"]) {
      const entry = entries.find((e) => e.fullName === name)!;
      const toggled = await app.inject({
        method: "PATCH",
        url: `/v1/admin/rooms/${room.id}/roster/${entry.id}/paper-mode`,
        headers: { cookie: adminCookie },
        payload: { votesOnPaper: true },
      });
      expect(toggled.statusCode).toBe(200);
    }

    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: pauloEntry.accessCode!.code, joinKey: "paulo-key-000001" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: silasEntry.accessCode!.code, joinKey: "silas-key-000002" },
    });

    const roundRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(roundRes.statusCode).toBe(201);
    const roundId = roundRes.json().round.id as string;

    // Both online voters cast votes: 1 for Paulo, 1 for Silas (online alone is tied 1-1 -> no majority)
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "paulo-key-000001", candidateId: paulo.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: "silas-key-000002", candidateId: silas.id },
    });

    // Cannot switch an online voter who already voted in the open round to paper mode
    const switchVotedToPaper = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/roster/${pauloEntry.id}/paper-mode`,
      headers: { cookie: adminCookie },
      payload: { votesOnPaper: true },
    });
    expect(switchVotedToPaper.statusCode).toBe(409);
    expect(switchVotedToPaper.json()).toMatchObject({ error: "already_voted_online" });

    // Validation errors on PUT /paper-tally
    const exceedVoters = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 4,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { [silas.id]: 4 },
      },
    });
    expect(exceedVoters.statusCode).toBe(400);
    expect(exceedVoters.json()).toMatchObject({ error: "paper_ballots_exceed_voters" });

    const mismatchMarks = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 3,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { [silas.id]: 2 },
      },
    });
    expect(mismatchMarks.statusCode).toBe(400);
    expect(mismatchMarks.json()).toMatchObject({ error: "paper_marks_mismatch_ballots" });

    // Record initial paper tally, then edit before closing
    const firstPut = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 2,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { [paulo.id]: 1, [silas.id]: 1 },
      },
    });
    expect(firstPut.statusCode).toBe(200);
    expect(firstPut.json().paperTally).toMatchObject({
      roundId,
      ballotCount: 2,
      recordedByName: "Ada Admin",
    });

    // Cannot undo paper mode while open round already has recorded paper ballots (> 0)
    const lucasEntry = entries.find((e) => e.fullName === "Lucas")!;
    const undoAfterPaperTally = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/roster/${lucasEntry.id}/paper-mode`,
      headers: { cookie: adminCookie },
      payload: { votesOnPaper: false },
    });
    expect(undoAfterPaperTally.statusCode).toBe(409);
    expect(undoAfterPaperTally.json()).toMatchObject({ error: "paper_tally_already_recorded" });

    const editPut = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 3,
        blankVotes: 1,
        nullVotes: 0,
        candidateVotes: { [silas.id]: 2 },
      },
    });
    expect(editPut.statusCode).toBe(200);
    expect(editPut.json().paperTally).toMatchObject({
      ballotCount: 3,
      blankVotes: 1,
      nullVotes: 0,
      candidateVotes: { [silas.id]: 2 },
      recordedByName: "Ada Admin",
    });

    // While open, GET /v1/admin/rooms/:roomId exposes round.paperTally
    const detailWhileOpen = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailWhileOpen.statusCode).toBe(200);
    expect(detailWhileOpen.json().room.round.paperTally).toMatchObject({
      ballotCount: 3,
      blankVotes: 1,
      nullVotes: 0,
      recordedByName: "Ada Admin",
    });

    // Close round: online (1 Paulo, 1 Silas) + paper (2 Silas, 1 blank) = 5 totalVotes -> threshold 3 -> Silas wins with 3!
    const closeRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
    expect(closeRes.statusCode).toBe(200);
    expect(closeRes.json()).toMatchObject({
      round: {
        id: roundId,
        status: "closed",
        outcome: "elected",
        tally: {
          totalVotes: 5,
          nullVotes: 1,
          threshold: 3,
          outcome: "elected",
          winnerId: silas.id,
          winnerName: "Silas",
          standings: [
            { candidateId: silas.id, displayName: "Silas", votes: 3, onlineVotes: 1, paperVotes: 2 },
            { candidateId: paulo.id, displayName: "Paulo", votes: 1, onlineVotes: 1, paperVotes: 0 },
          ],
          voteOrigin: {
            online: { ballots: 2, candidateVotes: 2, blankVotes: 0 },
            paper: { ballots: 3, candidateVotes: 2, blankVotes: 1, nullVotes: 0 },
          },
        },
      },
      quorum: {
        presentCount: 5,
        onlinePresentCount: 2,
        paperVotersCount: 3,
        eligibleCount: 5,
        requiredCount: 3,
        quorumMet: true,
      },
    });

    // Editing paper tally after round closed is rejected with 409 round_not_open
    const postClosePut = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/paper-tally`,
      headers: { cookie: adminCookie },
      payload: {
        ballotCount: 3,
        blankVotes: 0,
        nullVotes: 0,
        candidateVotes: { [paulo.id]: 3 },
      },
    });
    expect(postClosePut.statusCode).toBe(409);
    expect(postClosePut.json()).toMatchObject({ error: "round_not_open" });

    // T3.3: GET /v1/admin/rooms/:roomId returns voteOrigin, onlineVotes/paperVotes, AND round.paperTally
    const adminDetail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json().room.round.tally).toEqual(closeRes.json().round.tally);
    expect(adminDetail.json().room.round.paperTally).toMatchObject({
      ballotCount: 3,
      blankVotes: 1,
      nullVotes: 0,
      recordedByName: "Ada Admin",
    });

    // T3.3: GET /v1/join/:token/ballot returns voteOrigin and per-standing onlineVotes/paperVotes
    const voterBallot = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(voterBallot.statusCode).toBe(200);
    expect(voterBallot.json().round.tally).toEqual(closeRes.json().round.tally);
    expect(voterBallot.json().round.paperTally).toBeUndefined();

    // T3.3: Audit trail contains paper_tally_recorded events with admin name & timestamp and valid hash chain
    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().chainValid).toBe(true);
    const paperAuditEvents = (
      auditRes.json().events as Array<{
        action: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }>
    ).filter((e) => e.action === "paper_tally_recorded");
    expect(paperAuditEvents).toHaveLength(2);
    expect(paperAuditEvents[1]!.payload).toMatchObject({
      roundId,
      roundNumber: 1,
      ballotCount: 3,
      blankVotes: 1,
      nullVotes: 0,
      recordedByName: "Ada Admin",
    });
    expect(paperAuditEvents[1]!.createdAt).toBeTruthy();

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
  const raw = Array.isArray(header) ? header.join(";") : (header ?? "");
  const match = /scelta_session=([^;]+)/.exec(raw);
  if (!match?.[1]) {
    throw new Error("Missing session cookie");
  }
  return `scelta_session=${match[1]}`;
}
