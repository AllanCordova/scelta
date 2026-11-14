import {
  candidates,
  createPgliteDatabase,
  participants,
  reactions,
  roomMemberCodes,
  rooms,
  type Db,
} from "@scelta/db";
import { REACTION_RATE_LIMIT_MAX } from "@scelta/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import type { PresencePublisher } from "../realtime.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-reactions@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-reactions@feature.test";
const memberPassword = "feature-member-password";
const joinKey = "join-key-reactions-0001";

describe("controlled reactions", () => {
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
    repository = createDrizzleRoomRepository(db, "Reactions feature church");
    userRepository = createDrizzleUserRepository(db, "Reactions feature church");
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
    await db.delete(reactions);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
  });

  it("allows an in-room participant to send allowlisted reactions without exposing identity or ballot choice", async () => {
    const publishReaction = vi.fn();
    const presencePublisher: PresencePublisher = {
      publishPresence: vi.fn(),
      publishReaction,
    };
    const app = await buildApp({ roomRepository: repository, userRepository, presencePublisher });

    const { roomId, inviteToken } = await createAndJoinRoom(app, adminCookie, joinKey);

    const badEmoji = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey, emoji: "💣" },
    });
    expect(badEmoji.statusCode).toBe(400);
    expect(badEmoji.json().error).toBe("invalid_reaction_emoji");

    const outsider = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey: "not-joined-key", emoji: "👏" },
    });
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().error).toBe("participant_not_in_room");

    const sent = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey, emoji: "👏" },
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ ok: true, emoji: "👏" });
    expect(sent.json().participantId).toBeUndefined();
    expect(sent.json().candidateId).toBeUndefined();

    expect(publishReaction).toHaveBeenCalledTimes(1);
    expect(publishReaction).toHaveBeenCalledWith(roomId, {
      emoji: "👏",
      at: expect.any(String),
    });

    const ballotState = await app.inject({
      method: "GET",
      url: `/v1/join/${inviteToken}/ballot`,
    });
    expect(ballotState.statusCode).toBe(200);
    expect(ballotState.json().reactionsEnabled).toBe(true);
    expect(ballotState.json().allowedReactions).toContain("👏");

    await app.close();
  });

  it("rate-limits excessive reactions per participant without blocking other participants", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const { roomId, inviteToken } = await createAndJoinRoom(app, adminCookie, joinKey);

    const simTwo = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 1 },
    });
    const codeTwo = (simTwo.json().accessCodes as Array<{ code: string }>)[0].code;
    const secondJoinKey = "join-key-reactions-0002";
    const joinTwo = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}`,
      payload: { code: codeTwo, joinKey: secondJoinKey },
    });
    expect(joinTwo.statusCode).toBe(200);

    for (let index = 0; index < REACTION_RATE_LIMIT_MAX; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/join/${inviteToken}/reactions`,
        payload: { joinKey, emoji: "🙏" },
      });
      expect(response.statusCode).toBe(201);
    }

    const limited = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey, emoji: "🙏" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("reaction_rate_limited");

    const otherParticipant = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey: secondJoinKey, emoji: "🎉" },
    });
    expect(otherParticipant.statusCode).toBe(201);

    await app.close();
  });

  it("rejects reactions for unknown invites and non-joinable rooms", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const { roomId, inviteToken } = await createAndJoinRoom(app, adminCookie, joinKey);

    const notFound = await app.inject({
      method: "POST",
      url: "/v1/join/non-existent-token/reactions",
      payload: { joinKey, emoji: "👏" },
    });
    expect(notFound.statusCode).toBe(404);

    const closeRes = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: adminCookie },
      payload: { status: "closed" },
    });
    expect(closeRes.statusCode).toBe(200);

    const closedRoomReaction = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey, emoji: "👏" },
    });
    expect(closedRoomReaction.statusCode).toBe(409);
    expect(closedRoomReaction.json().error).toBe("room_not_joinable");

    await app.close();
  });

  it("lets admin disable and re-enable reactions while blocking unauthenticated and non-admin callers", async () => {
    const publishReactionsConfig = vi.fn();
    const presencePublisher: PresencePublisher = {
      publishPresence: vi.fn(),
      publishReactionsConfig,
    };
    const app = await buildApp({ roomRepository: repository, userRepository, presencePublisher });
    const { roomId, inviteToken } = await createAndJoinRoom(app, adminCookie, joinKey);

    const unauthPatch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}`,
      payload: { reactionsEnabled: false },
    });
    expect(unauthPatch.statusCode).toBe(401);

    const nonAdminPatch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: memberCookie },
      payload: { reactionsEnabled: false },
    });
    expect(nonAdminPatch.statusCode).toBe(403);

    const disableRes = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: adminCookie },
      payload: { reactionsEnabled: false },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json().room.reactionsEnabled).toBe(false);
    expect(publishReactionsConfig).toHaveBeenCalledWith(roomId, false);

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey, emoji: "👍" },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe("reactions_disabled");

    const enableRes = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: adminCookie },
      payload: { reactionsEnabled: true },
    });
    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json().room.reactionsEnabled).toBe(true);
    expect(publishReactionsConfig).toHaveBeenCalledWith(roomId, true);

    const allowed = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/reactions`,
      payload: { joinKey, emoji: "👍" },
    });
    expect(allowed.statusCode).toBe(201);

    await app.close();
  });
});

async function createAndJoinRoom(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  participantJoinKey: string,
) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/admin/rooms",
    headers: { cookie: adminCookie },
    payload: {
      title: "Assembleia de Reações",
      roomType: "elder",
      rulesPreset: "ipb_local_officers",
      quorumValue: 1,
      quorumUnit: "absolute",
      status: "open",
      candidates: ["Presb. João"],
    },
  });
  expect(created.statusCode).toBe(201);
  const room = created.json().room as { id: string; inviteToken: string };

  const simCodes = await app.inject({
    method: "POST",
    url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
    headers: { cookie: adminCookie },
    payload: { count: 1 },
  });
  expect(simCodes.statusCode).toBe(200);
  const code = (simCodes.json().accessCodes as Array<{ code: string }>)[0].code;

  const joined = await app.inject({
    method: "POST",
    url: `/v1/join/${room.inviteToken}`,
    payload: { code, joinKey: participantJoinKey },
  });
  expect(joined.statusCode).toBe(200);

  return { roomId: room.id, inviteToken: room.inviteToken };
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
    throw new Error("Expected login cookie");
  }
  return first.split(";")[0] ?? first;
}
