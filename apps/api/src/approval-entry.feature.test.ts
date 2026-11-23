import {
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
  roomEntryRequests,
  roomMemberCodes,
  roomRoster,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { resetAuthAttempts } from "./auth/auth-attempts.js";
import { hashPassword } from "./auth/password.js";
import { createDrizzleRoomRepository } from "./rooms/drizzle-room-repository.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import {
  ENTRY_CONFIRM_RATE_LIMIT,
  ROSTER_SEARCH_RATE_LIMIT,
  resetRateLimits,
} from "./security/rate-limiter.js";
import { clearAuditEvents } from "./testing/database.js";
import { createDrizzleUserRepository } from "./users/drizzle-user-repository.js";
import type { UserRepository } from "./users/user-repository.js";

const adminEmail = "ada-approval@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-approval@feature.test";
const memberPassword = "feature-member-password";

const voterAKey = "join-key-approval-voter-a-0001";
const voterBKey = "join-key-approval-voter-b-0002";
const voterCKey = "join-key-approval-voter-c-0003";
const impostorKey = "join-key-approval-impostor-0004";

describe("T4.1, T4.2, T4.3 — approval entry mode, gate, roster search, and desk queue", () => {
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
    repository = createDrizzleRoomRepository(db, "Approval feature church");
    userRepository = createDrizzleUserRepository(db, "Approval feature church");

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
    resetRateLimits();
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

  it("T4.1: configures entryMode, entryOpen, and maxParticipants (defaulting to roster size), enforces gate and capacity while allowing same-session re-entry", async () => {
    await repository.createMember({
      fullName: "João Batista",
      isCommunicant: true,
      isMale: true,
      birthDate: "1980-03-14",
    });
    await repository.createMember({
      fullName: "Maria Oliveira",
      isCommunicant: true,
      isMale: false,
      birthDate: "1985-07-22",
    });
    await repository.createMember({
      fullName: "Pedro Santos",
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
        title: "Assembleia com Controle de Entrada",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        entryMode: "codigo",
        candidates: ["João Batista"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      shortCode: string;
      entryMode: string;
      entryOpen: boolean;
      maxParticipants: number | null;
      effectiveMaxParticipants: number;
      eligibleCount: number;
    };
    expect(room.entryMode).toBe("codigo");
    expect(room.entryOpen).toBe(true);
    expect(room.eligibleCount).toBe(3);
    expect(room.maxParticipants).toBeNull();
    expect(room.effectiveMaxParticipants).toBe(3);

    // Generate access codes for the 3 roster members
    const genRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/generate`,
      headers: { cookie: adminCookie },
    });
    expect(genRes.statusCode).toBe(200);
    const codes = genRes.json().accessCodes as Array<{ code: string; displayName: string }>;
    expect(codes).toHaveLength(3);

    // Override maxParticipants to 1
    const capRes = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { maxParticipants: 1 },
    });
    expect(capRes.statusCode).toBe(200);
    expect(capRes.json().room.maxParticipants).toBe(1);

    // First voter joins
    const firstJoin = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[0]!.code, joinKey: voterAKey },
    });
    expect(firstJoin.statusCode).toBe(200);

    // Second voter is blocked by capacity limit
    const fullJoin = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[1]!.code, joinKey: voterBKey },
    });
    expect(fullJoin.statusCode).toBe(409);
    expect(fullJoin.json().error).toBe("room_capacity_reached");

    // Same-session re-entry for first voter still succeeds even when full!
    const reentryFull = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[0]!.code, joinKey: voterAKey },
    });
    expect(reentryFull.statusCode).toBe(200);
    expect(reentryFull.json().alreadyJoined).toBe(true);

    // Open a round and verify entryOpen & maxParticipants can STILL be updated during open round
    const openRound = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(openRound.statusCode).toBe(201);

    // Close entry & reset maxParticipants to null (falls back to roster size 3)
    const closeEntry = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { entryOpen: false, maxParticipants: null },
    });
    expect(closeEntry.statusCode).toBe(200);
    expect(closeEntry.json().room.entryOpen).toBe(false);
    expect(closeEntry.json().room.maxParticipants).toBeNull();
    expect(closeEntry.json().room.effectiveMaxParticipants).toBe(3);

    // Preview shows entryOpen = false and presentCount = 1
    const previewClosed = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}`,
    });
    expect(previewClosed.statusCode).toBe(200);
    expect(previewClosed.json()).toMatchObject({
      entryMode: "codigo",
      entryOpen: false,
      maxParticipants: 3,
      presentCount: 1,
      canJoin: true,
    });
    expect(previewClosed.json()).not.toHaveProperty("inviteToken");

    // New voter blocked when entry is closed
    const closedJoin = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[1]!.code, joinKey: voterBKey },
    });
    expect(closedJoin.statusCode).toBe(409);
    expect(closedJoin.json().error).toBe("entry_closed");

    // Existing voter same-session re-entry still succeeds when entry is closed
    const reentryClosed = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[0]!.code, joinKey: voterAKey },
    });
    expect(reentryClosed.statusCode).toBe(200);
    expect(reentryClosed.json().alreadyJoined).toBe(true);

    // Reopen entry -> second voter can now enter
    const reopenEntry = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { entryOpen: true },
    });
    expect(reopenEntry.statusCode).toBe(200);

    const secondJoin = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[1]!.code, joinKey: voterBKey },
    });
    expect(secondJoin.statusCode).toBe(200);

    // Close round, close room, verify entry settings cannot be modified on closed room
    const roundId = openRound.json().round.id as string;
    await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
      payload: { confirmPending: true },
    });
    await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { status: "closed" },
    });

    const editClosed = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { entryOpen: false },
    });
    expect(editClosed.statusCode).toBe(409);
    expect(editClosed.json().error).toBe("room_closed");

    // Audit chain is valid and contains entry_closed, entry_opened, entry_config_changed
    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().chainValid).toBe(true);
    const actions = (auditRes.json().events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain("entry_config_changed");
    expect(actions).toContain("entry_closed");
    expect(actions).toContain("entry_opened");

    await app.close();
  });

  it("T4.2: supports accent-insensitive roster search without leaking birthDate, birth day/month confirmation, disputes, and approved voter voting", async () => {
    await repository.createMember({
      fullName: "José Ávila",
      isCommunicant: true,
      isMale: true,
      birthDate: "1978-09-05",
    });
    await repository.createMember({
      fullName: "Ana Sem Data",
      isCommunicant: true,
      isMale: false,
      birthDate: null,
    });
    await repository.createMember({
      fullName: "Carlos Papel",
      isCommunicant: true,
      isMale: true,
      birthDate: "1990-01-10",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Assembleia Aprovação",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        entryMode: "aprovacao",
        candidates: ["José Ávila"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      shortCode: string;
      candidates: Array<{ id: string }>;
    };

    // Mark Carlos Papel as paper voter -> excluded from online search & entry requests
    const rosterRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    const rosterEntries = rosterRes.json().entries as Array<{ id: string; fullName: string }>;
    const carlosEntry = rosterEntries.find((e) => e.fullName === "Carlos Papel")!;
    await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}/roster/${carlosEntry.id}/paper-mode`,
      headers: { cookie: adminCookie },
      payload: { votesOnPaper: true },
    });

    // Normal code join is rejected in approval mode
    const codeJoinAttempt = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: "ABC234", joinKey: voterAKey },
    });
    expect(codeJoinAttempt.statusCode).toBe(409);
    expect(codeJoinAttempt.json().error).toBe("approval_entry_required");

    // Search query < 2 chars rejected
    const shortQuery = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/roster-search?q=j`,
    });
    expect(shortQuery.statusCode).toBe(400);
    expect(shortQuery.json().error).toBe("search_query_too_short");

    // Accent-insensitive search finds José Ávila without leaking birthDate
    const searchRes = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/roster-search?q=jose%20avila`,
    });
    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.body).not.toContain("1978");
    const searchEntries = searchRes.json().entries as Array<{
      rosterEntryId: string;
      fullName: string;
      requiresBirthDate: boolean;
      isClaimed: boolean;
    }>;
    expect(searchEntries).toEqual([
      {
        rosterEntryId: expect.any(String),
        fullName: "José Ávila",
        requiresBirthDate: true,
        isClaimed: false,
      },
    ]);
    const joseRosterId = searchEntries[0]!.rosterEntryId;

    // Paper voter is not returned in roster search
    const paperSearch = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/roster-search?q=carlos`,
    });
    expect(paperSearch.statusCode).toBe(200);
    expect(paperSearch.json().entries).toEqual([]);

    // Missing birth date returns 400
    const missingBirth = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: joseRosterId, joinKey: voterAKey },
    });
    expect(missingBirth.statusCode).toBe(400);
    expect(missingBirth.json().error).toBe("birth_date_required");

    // Wrong birth date returns 403
    const wrongBirth = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: joseRosterId, joinKey: voterAKey, birthDay: 10, birthMonth: 9 },
    });
    expect(wrongBirth.statusCode).toBe(403);
    expect(wrongBirth.json().error).toBe("birth_date_mismatch");

    // Correct birth day & month (05/09) creates pending request (without revealing inviteToken yet)
    const createdReq = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: joseRosterId, joinKey: voterAKey, birthDay: 5, birthMonth: 9 },
    });
    expect(createdReq.statusCode).toBe(201);
    expect(createdReq.json()).toMatchObject({
      status: "pending",
      displayName: "José Ávila",
      shortCode: room.shortCode,
    });
    expect(createdReq.json()).not.toHaveProperty("inviteToken");
    const requestId = createdReq.json().requestId as string;

    // Polling via query string without x-scelta-join-key header is rejected (secrets never accepted in URLs)
    const queryKeyPoll = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/entry-requests/${requestId}?joinKey=${voterAKey}`,
    });
    expect(queryKeyPoll.statusCode).toBe(401);
    expect(queryKeyPoll.json().error).toBe("join_key_required");

    // Polling with wrong joinKey returns 403
    const forbiddenPoll = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/entry-requests/${requestId}`,
      headers: { "x-scelta-join-key": voterBKey },
    });
    expect(forbiddenPoll.statusCode).toBe(403);

    // Polling with right joinKey returns pending without inviteToken
    const pendingPoll = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/entry-requests/${requestId}`,
      headers: { "x-scelta-join-key": voterAKey },
    });
    expect(pendingPoll.statusCode).toBe(200);
    expect(pendingPoll.json().status).toBe("pending");
    expect(pendingPoll.json()).not.toHaveProperty("inviteToken");

    // Roster entry without birthDate goes straight to pending
    const anaSearch = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/roster-search?q=ana`,
    });
    const anaRosterId = anaSearch.json().entries[0].rosterEntryId as string;
    expect(anaSearch.json().entries[0].requiresBirthDate).toBe(false);
    const anaReq = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: anaRosterId, joinKey: voterBKey },
    });
    expect(anaReq.statusCode).toBe(201);
    expect(anaReq.json().status).toBe("pending");

    // Second browser attempting to claim José Ávila while pending is refused 409 and signals dispute
    const duplicatePending = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: {
        rosterEntryId: joseRosterId,
        joinKey: impostorKey,
        birthDay: 5,
        birthMonth: 9,
      },
    });
    expect(duplicatePending.statusCode).toBe(409);
    expect(duplicatePending.json().error).toBe("roster_name_already_claimed");

    // Desk approves José Ávila
    const approvedRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/${requestId}/approve`,
      headers: { cookie: adminCookie },
    });
    expect(approvedRes.statusCode).toBe(200);
    expect(approvedRes.json().request.status).toBe("approved");

    // Voter polls and now receives status=approved AND inviteToken
    const approvedPoll = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/entry-requests/${requestId}`,
      headers: { "x-scelta-join-key": voterAKey },
    });
    expect(approvedPoll.statusCode).toBe(200);
    expect(approvedPoll.json()).toMatchObject({
      status: "approved",
      displayName: "José Ávila",
      inviteToken: room.inviteToken,
    });

    // Open round and let approved voter cast a ballot
    const roundRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(roundRes.statusCode).toBe(201);

    const ballotState = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
      headers: { "x-scelta-join-key": voterAKey },
    });
    expect(ballotState.statusCode).toBe(200);
    expect(ballotState.json().viewerAccess).toBe("present");

    const voteRes = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voterAKey, candidateId: room.candidates[0]!.id },
    });
    expect(voteRes.statusCode).toBe(201);

    // Duplicate claim after approval is also refused 409 and increments dispute
    const duplicateAfterApproval = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: {
        rosterEntryId: joseRosterId,
        joinKey: voterCKey,
        birthDay: 5,
        birthMonth: 9,
      },
    });
    expect(duplicateAfterApproval.statusCode).toBe(409);
    expect(duplicateAfterApproval.json().error).toBe("roster_name_already_claimed");

    // Check full logs include entry_request_created, entry_request_disputed, entry_request_approved, and valid chain
    const logsRes = await app.inject({
      method: "GET",
      url: `/v1/admin/logs?roomId=${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(logsRes.statusCode).toBe(200);
    expect(logsRes.json().summary.chainValid).toBe(true);
    const logActions = (logsRes.json().logs as Array<{ action: string }>).map((l) => l.action);
    expect(logActions).toContain("entry_request_created");
    expect(logActions).toContain("entry_request_disputed");
    expect(logActions).toContain("entry_request_approved");
    expect(logActions).toContain("participant_joined");
    expect(logActions).toContain("ballot_cast");

    await app.close();
  });

  it("T4.2: enforces rate limits on roster search and failed birth-date confirmations", async () => {
    await repository.createMember({
      fullName: "Lucas Ferreira",
      isCommunicant: true,
      isMale: true,
      birthDate: "1988-11-20",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });
    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Sala Limite Taxa",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        entryMode: "aprovacao",
        candidates: ["Lucas Ferreira"],
      },
    });
    const room = created.json().room as { id: string; shortCode: string };

    const rosterRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    const lucasRosterId = rosterRes.json().entries[0].id as string;

    // Exhaust ENTRY_CONFIRM_RATE_LIMIT with wrong birth dates
    for (let i = 0; i < ENTRY_CONFIRM_RATE_LIMIT.limit; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: `/v1/join/s/${room.shortCode}/entry-requests`,
        payload: { rosterEntryId: lucasRosterId, joinKey: voterAKey, birthDay: 1, birthMonth: 1 },
      });
      expect(res.statusCode).toBe(403);
    }

    const confirmLimited = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: lucasRosterId, joinKey: voterAKey, birthDay: 20, birthMonth: 11 },
    });
    expect(confirmLimited.statusCode).toBe(429);
    expect(confirmLimited.json().error).toBe("rate_limited");

    // Exhaust ROSTER_SEARCH_RATE_LIMIT
    for (let i = 0; i < ROSTER_SEARCH_RATE_LIMIT.limit; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/join/s/${room.shortCode}/roster-search?q=lucas`,
      });
      expect(res.statusCode).toBe(200);
    }

    const searchLimited = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/roster-search?q=lucas`,
    });
    expect(searchLimited.statusCode).toBe(429);
    expect(searchLimited.json().error).toBe("rate_limited");

    await app.close();
  });

  it("T4.3: desk lists queue & disputes, rejects, approves all, expels impostor & releases name so real person enters and votes", async () => {
    await repository.createMember({
      fullName: "Mateus Rocha",
      isCommunicant: true,
      isMale: true,
      birthDate: "1991-04-12",
    });
    await repository.createMember({
      fullName: "Sara Lima",
      isCommunicant: true,
      isMale: false,
      birthDate: null,
    });
    await repository.createMember({
      fullName: "Tiago Costa",
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
        title: "Mesa Aprovação",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        entryMode: "aprovacao",
        candidates: ["Mateus Rocha"],
      },
    });
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      shortCode: string;
      candidates: Array<{ id: string }>;
    };

    // Non-admin cannot access approval queue
    const forbiddenQueue = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/entry-requests`,
      headers: { cookie: memberCookie },
    });
    expect(forbiddenQueue.statusCode).toBe(403);

    const rosterRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/roster`,
      headers: { cookie: adminCookie },
    });
    const entries = rosterRes.json().entries as Array<{ id: string; fullName: string }>;
    const mateusId = entries.find((e) => e.fullName === "Mateus Rocha")!.id;
    const saraId = entries.find((e) => e.fullName === "Sara Lima")!.id;
    const tiagoId = entries.find((e) => e.fullName === "Tiago Costa")!.id;

    // 1. Impostor claims Mateus Rocha and gets approved
    const impostorReq = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: {
        rosterEntryId: mateusId,
        joinKey: impostorKey,
        birthDay: 12,
        birthMonth: 4,
      },
    });
    expect(impostorReq.statusCode).toBe(201);
    const impostorReqId = impostorReq.json().requestId as string;

    const approveImpostor = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/${impostorReqId}/approve`,
      headers: { cookie: adminCookie },
    });
    expect(approveImpostor.statusCode).toBe(200);

    // 2. Real Mateus attempts to enter -> 409 + dispute alert
    const realAttempt = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: {
        rosterEntryId: mateusId,
        joinKey: voterAKey,
        birthDay: 12,
        birthMonth: 4,
      },
    });
    expect(realAttempt.statusCode).toBe(409);
    expect(realAttempt.json().error).toBe("roster_name_already_claimed");

    // 3. Desk sees dispute alert in GET /entry-requests
    const queueWithDispute = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/entry-requests`,
      headers: { cookie: adminCookie },
    });
    expect(queueWithDispute.statusCode).toBe(200);
    expect(queueWithDispute.json().disputes).toEqual([
      expect.objectContaining({
        rosterEntryId: mateusId,
        displayName: "Mateus Rocha",
        disputedAttemptCount: 1,
        currentHolderStatus: "approved",
      }),
    ]);

    // 4. Desk expels impostor and releases Mateus Rocha's name
    const releaseRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/release-name`,
      headers: { cookie: adminCookie },
      payload: { rosterEntryId: mateusId },
    });
    expect(releaseRes.statusCode).toBe(200);
    expect(releaseRes.json()).toMatchObject({
      released: true,
      rosterEntryId: mateusId,
      displayName: "Mateus Rocha",
    });

    // Impostor session is now invalidated
    const impostorBallot = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
      headers: { "x-scelta-join-key": impostorKey },
    });
    expect(impostorBallot.statusCode).toBe(200);
    expect(impostorBallot.json().viewerAccess).toBe("missing");

    // 5. Real Mateus, Sara, and Tiago all submit entry requests
    const realMateusReq = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: mateusId, joinKey: voterAKey, birthDay: 12, birthMonth: 4 },
    });
    expect(realMateusReq.statusCode).toBe(201);

    const saraReq = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: saraId, joinKey: voterBKey },
    });
    expect(saraReq.statusCode).toBe(201);
    const saraReqId = saraReq.json().requestId as string;

    const tiagoReq = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}/entry-requests`,
      payload: { rosterEntryId: tiagoId, joinKey: voterCKey },
    });
    expect(tiagoReq.statusCode).toBe(201);

    // 6. Desk rejects Sara
    const rejectSara = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/${saraReqId}/reject`,
      headers: { cookie: adminCookie },
    });
    expect(rejectSara.statusCode).toBe(200);
    expect(rejectSara.json().request.status).toBe("rejected");

    const saraPoll = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}/entry-requests/${saraReqId}`,
      headers: { "x-scelta-join-key": voterBKey },
    });
    expect(saraPoll.statusCode).toBe(200);
    expect(saraPoll.json().status).toBe("rejected");
    expect(saraPoll.json()).not.toHaveProperty("inviteToken");

    // 7. Desk clicks "Aprovar todos" -> approves real Mateus and Tiago
    const approveAll = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/entry-requests/approve-all`,
      headers: { cookie: adminCookie },
    });
    expect(approveAll.statusCode).toBe(200);
    expect(approveAll.json()).toMatchObject({
      approvedCount: 2,
      skippedCount: 0,
    });
    expect(approveAll.json().presence.presentCount).toBe(2);

    // 8. Real Mateus votes in open round; impostor cannot vote
    const openRound = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(openRound.statusCode).toBe(201);

    const impostorVote = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: impostorKey, candidateId: room.candidates[0]!.id },
    });
    expect(impostorVote.statusCode).toBe(403);

    const realVote = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: voterAKey, candidateId: room.candidates[0]!.id },
    });
    expect(realVote.statusCode).toBe(201);

    // Verify full audit chain integrity
    const verifyRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit/verify`,
      headers: { cookie: adminCookie },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().chainValid).toBe(true);

    const auditEventsRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    const adminActions = (auditEventsRes.json().events as Array<{ action: string }>).map(
      (e) => e.action,
    );
    expect(adminActions).toContain("entry_request_approved");
    expect(adminActions).toContain("entry_request_rejected");
    expect(adminActions).toContain("roster_name_released");

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
