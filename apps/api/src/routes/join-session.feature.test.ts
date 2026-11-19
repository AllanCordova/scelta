import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ballots,
  candidates,
  churches,
  createPgliteDatabase,
  members,
  MIGRATIONS_FOLDER,
  participants,
  roomMemberCodes,
  roomRoster,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { isValidRoomShortCode } from "@scelta/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import { hashJoinKey } from "../rooms/join-key.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { JOIN_RATE_LIMIT, resetRateLimits } from "../security/rate-limiter.js";
import { clearAuditEvents } from "../testing/database.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-session@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-session@feature.test";
const memberPassword = "feature-member-password";
const browserAKey = "join-key-browser-a-0001";
const browserBKey = "join-key-browser-b-0002";
const browserCKey = "join-key-browser-c-0003";

describe("room short code and one-session-per-code", () => {
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
    repository = createDrizzleRoomRepository(db, "Session feature church");
    userRepository = createDrizzleUserRepository(db, "Session feature church");
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
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(roomRoster);
    await clearAuditEvents(db);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("exposes shortCode in room DTOs, joins via /v1/join/s/:shortCode with normalization, and rate-limits failures", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, adminCookie, "Assembleia Curta", "open");
    expect(isValidRoomShortCode(room.shortCode)).toBe(true);
    expect(room.shortPath).toBe(`/s/${room.shortCode}`);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().rooms[0]).toMatchObject({
      id: room.id,
      shortCode: room.shortCode,
      shortPath: `/s/${room.shortCode}`,
    });

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().room).toMatchObject({
      id: room.id,
      shortCode: room.shortCode,
      shortPath: `/s/${room.shortCode}`,
    });

    const [accessCode] = await createRoomCodes(app, room.id, 1, adminCookie);

    const hyphenated = `${room.shortCode.slice(0, 3).toLowerCase()}-${room.shortCode.slice(3).toLowerCase()}`;
    const preview = await app.inject({
      method: "GET",
      url: `/v1/join/s/${hyphenated}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({
      title: "Assembleia Curta",
      status: "open",
      shortCode: room.shortCode,
      canJoin: true,
    });
    expect(preview.json()).not.toHaveProperty("inviteToken");

    const joined = await app.inject({
      method: "POST",
      url: `/v1/join/s/${hyphenated}`,
      payload: {
        code: accessCode!.code.toLowerCase(),
        joinKey: browserAKey,
      },
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toEqual({
      title: "Assembleia Curta",
      status: "open",
      shortCode: room.shortCode,
      inviteToken: room.inviteToken,
      displayName: accessCode!.displayName,
      presentCount: 1,
      alreadyJoined: false,
    });

    const unknownPreview = await app.inject({
      method: "GET",
      url: "/v1/join/s/ZZZZZZ",
    });
    expect(unknownPreview.statusCode).toBe(404);
    expect(unknownPreview.json()).toEqual({ error: "invite_not_found" });

    for (let attempt = 0; attempt < JOIN_RATE_LIMIT.limit; attempt += 1) {
      const invalidCode = await app.inject({
        method: "POST",
        url: `/v1/join/s/${room.shortCode}`,
        payload: { code: "ZZZZZZ", joinKey: browserBKey },
      });
      expect(invalidCode.statusCode).toBe(403);
      expect(invalidCode.json()).toEqual({
        error: "invalid_access_code",
        message: "Código de acesso inválido ou revogado.",
      });
    }

    const rateLimited = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: "ZZZZZZ", joinKey: browserBKey },
    });
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.json().error).toBe("rate_limited");

    await app.close();
  });

  it("keeps shortCode working after rotating inviteToken while invalidating the old invite token", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, adminCookie, "Rotação de Convite", "open");
    const [accessCode] = await createRoomCodes(app, room.id, 1, adminCookie);

    const rotated = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/invite/rotate`,
      headers: { cookie: adminCookie },
    });
    expect(rotated.statusCode).toBe(200);
    const rotatedRoom = rotated.json().room as { inviteToken: string; shortCode: string };
    expect(rotatedRoom.inviteToken).not.toBe(room.inviteToken);
    expect(rotatedRoom.shortCode).toBe(room.shortCode);

    const oldInvite = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}`,
    });
    expect(oldInvite.statusCode).toBe(404);

    const shortPreview = await app.inject({
      method: "GET",
      url: `/v1/join/s/${room.shortCode}`,
    });
    expect(shortPreview.statusCode).toBe(200);
    expect(shortPreview.json()).toMatchObject({
      title: "Rotação de Convite",
      shortCode: room.shortCode,
      canJoin: true,
    });

    const joinedViaShort = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: accessCode!.code, joinKey: browserAKey },
    });
    expect(joinedViaShort.statusCode).toBe(200);
    expect(joinedViaShort.json()).toMatchObject({
      shortCode: room.shortCode,
      inviteToken: rotatedRoom.inviteToken,
      presentCount: 1,
    });

    await app.close();
  });

  it("enforces one session per access code with 409 conflict while allowing same-browser re-entry", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, adminCookie, "Sessão Única", "open");
    const [accessCode] = await createRoomCodes(app, room.id, 1, adminCookie);

    const firstJoin = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: accessCode!.code, joinKey: browserAKey },
    });
    expect(firstJoin.statusCode).toBe(200);
    expect(firstJoin.json().alreadyJoined).toBe(false);

    // Second browser with different joinKey is rejected via both token and short code
    const secondViaToken = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: accessCode!.code, joinKey: browserBKey },
    });
    expect(secondViaToken.statusCode).toBe(409);
    expect(secondViaToken.json()).toEqual({
      error: "access_code_in_use",
      message: "Este código já está em uso. Procure a mesa.",
    });

    const secondViaShort = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: accessCode!.code, joinKey: browserBKey },
    });
    expect(secondViaShort.statusCode).toBe(409);
    expect(secondViaShort.json()).toEqual({
      error: "access_code_in_use",
      message: "Este código já está em uso. Procure a mesa.",
    });

    // Original binding in DB was NOT overwritten
    const stored = await db.select().from(participants).where(eq(participants.roomId, room.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.joinKeyHash).toBe(hashJoinKey(browserAKey));

    // Same browser re-entry succeeds even if previously marked absent
    await db.update(participants).set({ isPresent: false }).where(eq(participants.roomId, room.id));
    const reEntry = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: accessCode!.code, joinKey: browserAKey },
    });
    expect(reEntry.statusCode).toBe(200);
    expect(reEntry.json()).toMatchObject({
      alreadyJoined: true,
      presentCount: 1,
    });

    await app.close();
  });

  it("releases a participant session, records immutable audit, allows new browser, and blocks double voting", async () => {
    const presenceEvents: Array<{ roomId: string; presentCount: number }> = [];
    const app = await buildApp({
      roomRepository: repository,
      userRepository,
      presencePublisher: {
        publishPresence(roomId, presence) {
          presenceEvents.push({ roomId, presentCount: presence.presentCount });
        },
      },
    });
    const room = await createRoom(app, adminCookie, "Liberação de Sessão", "open");
    const [code1, code2] = await createRoomCodes(app, room.id, 2, adminCookie);

    const join1 = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: code1!.code, joinKey: browserAKey },
    });
    expect(join1.statusCode).toBe(200);

    const join2 = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: code2!.code, joinKey: browserCKey },
    });
    expect(join2.statusCode).toBe(200);

    const participantsRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/participants`,
      headers: { cookie: adminCookie },
    });
    expect(participantsRes.statusCode).toBe(200);
    const list = participantsRes.json().participants as Array<{ id: string; displayName: string }>;
    const p1 = list.find((item) => item.displayName === code1!.displayName)!;
    const p2 = list.find((item) => item.displayName === code2!.displayName)!;
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();

    // Open round and let p1 cast a ballot with browser A
    const openRoundRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
    });
    expect(openRoundRes.statusCode).toBe(201);
    const roundId = (openRoundRes.json().round as { id: string }).id;

    const firstVote = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: browserAKey, candidateId: room.candidates[0]!.id },
    });
    expect(firstVote.statusCode).toBe(201);

    // Release endpoint enforces admin authz
    const unauthRelease = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/${p1.id}/release-session`,
    });
    expect(unauthRelease.statusCode).toBe(401);

    const memberRelease = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/${p1.id}/release-session`,
      headers: { cookie: memberCookie },
    });
    expect(memberRelease.statusCode).toBe(403);

    const missingParticipantRelease = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/00000000-0000-4000-8000-000000000000/release-session`,
      headers: { cookie: adminCookie },
    });
    expect(missingParticipantRelease.statusCode).toBe(404);

    // Admin releases p1's session
    const released1 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/${p1.id}/release-session`,
      headers: { cookie: adminCookie },
    });
    expect(released1.statusCode).toBe(200);
    expect(released1.json()).toMatchObject({
      released: true,
      participant: {
        id: p1.id,
        displayName: p1.displayName,
        isPresent: false,
      },
      presence: {
        presentCount: 1,
      },
    });
    expect(presenceEvents[presenceEvents.length - 1]).toEqual({
      roomId: room.id,
      presentCount: 1,
    });

    // Release p2 as well to confirm multiple NULL join_key_hash rows coexist in the same room
    const released2 = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/participants/${p2.id}/release-session`,
      headers: { cookie: adminCookie },
    });
    expect(released2.statusCode).toBe(200);
    expect(released2.json().presence.presentCount).toBe(0);

    // Audit trail contains session_released without secrets/hashes/choices and passes chain verification
    const auditRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}/audit`,
      headers: { cookie: adminCookie },
    });
    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().chainValid).toBe(true);
    const releaseEvent = (
      auditRes.json().events as Array<{ action: string; payload: Record<string, unknown> }>
    ).find((event) => event.action === "session_released" && event.payload.participantId === p1.id);
    expect(releaseEvent).toBeDefined();
    expect(releaseEvent?.payload).toMatchObject({
      participantId: p1.id,
      displayName: p1.displayName,
    });
    expect(JSON.stringify(releaseEvent)).not.toContain(browserAKey);
    expect(JSON.stringify(releaseEvent)).not.toContain(hashJoinKey(browserAKey));
    expect(JSON.stringify(releaseEvent)).not.toContain(room.candidates[0]!.id);

    // Old browser A can no longer vote or claim presence
    const oldBrowserBallot = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: browserAKey, candidateId: room.candidates[1]!.id },
    });
    expect(oldBrowserBallot.statusCode).toBe(403);
    expect(oldBrowserBallot.json()).toEqual({ error: "participant_not_present" });

    // New browser B joins with code1 and keeps the same participant id
    const rejoinNewBrowser = await app.inject({
      method: "POST",
      url: `/v1/join/s/${room.shortCode}`,
      payload: { code: code1!.code, joinKey: browserBKey },
    });
    expect(rejoinNewBrowser.statusCode).toBe(200);
    expect(rejoinNewBrowser.json()).toMatchObject({
      displayName: p1.displayName,
      presentCount: 1,
      alreadyJoined: false,
    });

    const [p1RowAfter] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, p1.id));
    expect(p1RowAfter?.id).toBe(p1.id);
    expect(p1RowAfter?.joinKeyHash).toBe(hashJoinKey(browserBKey));
    expect(p1RowAfter?.isPresent).toBe(true);

    // Receipt check shows already voted, and second ballot in the same round is rejected!
    const receiptCheck = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot/receipt`,
      payload: { joinKey: browserBKey },
    });
    expect(receiptCheck.statusCode).toBe(200);
    expect(receiptCheck.json()).toEqual({ roundId, hasVoted: true });

    const secondVoteAttempt = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}/ballot`,
      payload: { joinKey: browserBKey, candidateId: room.candidates[1]!.id },
    });
    expect(secondVoteAttempt.statusCode).toBe(409);
    expect(secondVoteAttempt.json()).toEqual({ error: "already_voted" });

    const storedBallots = await db.select().from(ballots).where(eq(ballots.roundId, roundId));
    const storedReceipts = await db
      .select()
      .from(voteReceipts)
      .where(eq(voteReceipts.roundId, roundId));
    expect(storedBallots).toHaveLength(1);
    expect(storedReceipts).toHaveLength(1);

    await app.close();
  });

  it("backfills deterministic unique 6-char short_code values for pre-existing rooms during migration 0001", async () => {
    const legacy = await createPgliteDatabase();
    try {
      await legacy.db.execute(sql.raw("DROP INDEX IF EXISTS rooms_short_code_uidx"));
      await legacy.db.execute(sql.raw("ALTER TABLE rooms DROP COLUMN IF EXISTS short_code"));

      const [church] = await legacy.db
        .insert(churches)
        .values({ name: "Legacy Church" })
        .returning({ id: churches.id });
      const churchId = church!.id;

      await legacy.db.execute(
        sql`INSERT INTO rooms (church_id, title, room_type, quorum_value, invite_token)
            VALUES (${churchId}, 'Sala Legada 1', 'elder', 1, 'legacy-token-1'),
                   (${churchId}, 'Sala Legada 2', 'elder', 1, 'legacy-token-2'),
                   (${churchId}, 'Sala Legada 3', 'elder', 1, 'legacy-token-3')`,
      );

      const sql0001 = readFileSync(
        resolve(MIGRATIONS_FOLDER, "0001_room_short_code_and_session_release.sql"),
        "utf8",
      );
      for (const statement of sql0001.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed) {
          await legacy.db.execute(sql.raw(trimmed));
        }
      }

      const migratedRooms = await legacy.db
        .select({ title: rooms.title, shortCode: rooms.shortCode })
        .from(rooms)
        .orderBy(rooms.title);
      expect(migratedRooms).toHaveLength(3);
      const codes = migratedRooms.map((row) => row.shortCode);
      for (const code of codes) {
        expect(isValidRoomShortCode(code)).toBe(true);
      }
      expect(new Set(codes).size).toBe(3);
    } finally {
      await legacy.close();
    }
  });
});

async function createRoom(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  title: string,
  status: "draft" | "open" | "test",
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/rooms",
    headers: { cookie: adminCookie },
    payload: {
      title,
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      status,
      candidates: ["Paulo", "Silas"],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().room as {
    id: string;
    inviteToken: string;
    shortCode: string;
    shortPath: string;
    candidates: Array<{ id: string; displayName: string }>;
  };
}

async function createRoomCodes(
  app: Awaited<ReturnType<typeof buildApp>>,
  roomId: string,
  count: number,
  cookie: string,
) {
  const suffix = Math.random().toString(36).slice(2, 7);
  for (let i = 0; i < count; i += 1) {
    const memberRes = await app.inject({
      method: "POST",
      url: "/v1/admin/members",
      headers: { cookie },
      payload: {
        fullName: `Eleitor Sessão ${suffix} ${i + 1}`,
        isCommunicant: true,
        isMale: true,
        birthDate: "1990-01-01",
      },
    });
    expect(memberRes.statusCode).toBe(201);
    const memberId = (memberRes.json().member as { id: string }).id;
    const rosterRes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/roster`,
      headers: { cookie },
      payload: { memberId },
    });
    expect(rosterRes.statusCode).toBe(201);
  }
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/rooms/${roomId}/access-codes/generate`,
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  const allCodes = (
    response.json() as {
      accessCodes: Array<{ id: string; code: string; displayName: string }>;
    }
  ).accessCodes;
  return allCodes.filter((item) => item.displayName.includes(suffix)).slice(0, count);
}

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
    throw new Error("Missing session cookie");
  }
  return first.split(";")[0] ?? first;
}
