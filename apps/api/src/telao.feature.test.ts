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

const adminEmail = "ada-telao@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-telao@feature.test";
const memberPassword = "feature-member-password";

describe("T6.2 & T6.3 — telão reveal and live partial candidate tally", () => {
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
    repository = createDrizzleRoomRepository(db, "Telao feature church");
    userRepository = createDrizzleUserRepository(db, "Telao feature church");

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

  it("T6.3 & T6.2: keeps live candidate partial hidden by default, allows toggling during open scrutiny, and reveals closed result on desk action", async () => {
    const telaoEvents: string[] = [];
    const app = await buildApp({
      roomRepository: repository,
      userRepository,
      presencePublisher: {
        publishPresence() {},
        publishTelaoUpdated(roomId) {
          telaoEvents.push(roomId);
        },
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Assembleia Telão",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 2,
        quorumUnit: "absolute",
        status: "test",
        candidates: ["Presb. Marcos", "Presb. Lucas"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      showLiveCandidateTally: boolean;
      candidates: Array<{ id: string; displayName: string }>;
    };
    expect(room.showLiveCandidateTally).toBe(false);

    const marcos = room.candidates.find((c) => c.displayName === "Presb. Marcos")!;
    const lucas = room.candidates.find((c) => c.displayName === "Presb. Lucas")!;

    // Join 2 simulated voters
    const simCodes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 2 },
    });
    const codes = simCodes.json().accessCodes as Array<{ code: string }>;
    const key1 = "join-key-telao-voter-0001";
    const key2 = "join-key-telao-voter-0002";

    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[0]!.code, joinKey: key1 },
    });
    await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[1]!.code, joinKey: key2 },
    });

    // Open round
    const opened = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(opened.statusCode).toBe(201);
    const roundId = opened.json().round.id as string;
    expect(opened.json().round.resultRevealed).toBe(false);

    // Reveal while round is still open -> 409 round_not_closed
    const revealOpen = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/reveal`,
      headers: { cookie: adminCookie },
    });
    expect(revealOpen.statusCode).toBe(409);
    expect(revealOpen.json().error).toBe("round_not_closed");

    // Cast 2 ballots: 1 for Marcos, 1 blank
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/join/${room.inviteToken}/ballot`,
          payload: { joinKey: key1, candidateIds: [marcos.id] },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/join/${room.inviteToken}/ballot`,
          payload: { joinKey: key2, candidateIds: [] },
        })
      ).statusCode,
    ).toBe(201);

    // With showLiveCandidateTally = false (default), liveTally exposes general totals only, NO standings
    const detailHidden = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailHidden.statusCode).toBe(200);
    expect(detailHidden.json().room.showLiveCandidateTally).toBe(false);
    expect(detailHidden.json().room.round.liveTally).toEqual({
      totalBallots: 2,
      onlineBallots: 2,
      paperBallots: 0,
      blankVotes: 1,
      nullVotes: 0,
    });
    expect(detailHidden.json().room.round.liveTally.standings).toBeUndefined();

    // T6.3: Enable showLiveCandidateTally DURING open scrutiny
    const enableLive = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { showLiveCandidateTally: true },
    });
    expect(enableLive.statusCode).toBe(200);
    expect(enableLive.json().room.showLiveCandidateTally).toBe(true);
    expect(telaoEvents).toContain(room.id);

    const detailVisible = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detailVisible.statusCode).toBe(200);
    expect(detailVisible.json().room.round.liveTally).toEqual({
      totalBallots: 2,
      onlineBallots: 2,
      paperBallots: 0,
      blankVotes: 1,
      nullVotes: 0,
      standings: [
        { candidateId: marcos.id, displayName: "Presb. Marcos", votes: 1 },
        { candidateId: lucas.id, displayName: "Presb. Lucas", votes: 0 },
      ],
    });
    // Anonymity check: voter keys never leak
    expect(detailVisible.body).not.toContain(key1);
    expect(detailVisible.body).not.toContain(key2);

    // Disable showLiveCandidateTally again during open scrutiny
    const disableLive = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { showLiveCandidateTally: false },
    });
    expect(disableLive.statusCode).toBe(200);
    expect(disableLive.json().room.showLiveCandidateTally).toBe(false);

    // Close round -> starts with resultRevealed = false
    const closed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/close`,
      headers: { cookie: adminCookie },
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().round.resultRevealed).toBe(false);

    // Non-admin cannot reveal
    const forbiddenReveal = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/reveal`,
      headers: { cookie: memberCookie },
    });
    expect(forbiddenReveal.statusCode).toBe(403);

    // Admin reveals result -> sets resultRevealed = true and broadcasts telao:updated
    telaoEvents.length = 0;
    const revealed = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/reveal`,
      headers: { cookie: adminCookie },
    });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.json().alreadyRevealed).toBe(false);
    expect(revealed.json().round.resultRevealed).toBe(true);
    expect(revealed.json().round.tally).toBeDefined();
    expect(telaoEvents).toEqual([room.id]);

    // Idempotent second reveal
    const revealedAgain = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds/${roundId}/reveal`,
      headers: { cookie: adminCookie },
    });
    expect(revealedAgain.statusCode).toBe(200);
    expect(revealedAgain.json().alreadyRevealed).toBe(true);
    expect(revealedAgain.json().round.resultRevealed).toBe(true);

    // Close room -> toggling showLiveCandidateTally is rejected 409 room_closed
    await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { status: "closed" },
    });
    const toggleClosed = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
      payload: { showLiveCandidateTally: true },
    });
    expect(toggleClosed.statusCode).toBe(409);
    expect(toggleClosed.json().error).toBe("room_closed");

    // Verify audit chain and new audit actions
    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().chainValid).toBe(true);
    const events = auditRes.json().events as Array<{
      action: string;
      payload: Record<string, unknown>;
    }>;
    const toggleEvents = events.filter((e) => e.action === "live_candidate_tally_toggled");
    expect(toggleEvents).toHaveLength(2);
    expect(toggleEvents[0]!.payload).toEqual({ previous: false, next: true });
    expect(toggleEvents[1]!.payload).toEqual({ previous: true, next: false });
    const revealEvents = events.filter((e) => e.action === "round_result_revealed");
    expect(revealEvents).toHaveLength(1);

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
