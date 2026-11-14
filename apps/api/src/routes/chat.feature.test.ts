import {
  auditEvents,
  candidates,
  createPgliteDatabase,
  participants,
  reactions,
  roomChatMessages,
  roomMemberCodes,
  rooms,
  type Db,
} from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import type { PresencePublisher } from "../realtime.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-chat@feature.test";
const adminPassword = "feature-admin-password";

async function createAndJoinRoom(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  joinKeys: string[],
) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/admin/rooms",
    headers: { cookie: adminCookie },
    payload: {
      title: "Assembleia com Chat",
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

  const simRes = await app.inject({
    method: "POST",
    url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
    headers: { cookie: adminCookie },
    payload: { count: joinKeys.length },
  });
  expect(simRes.statusCode).toBe(200);
  const codes = simRes.json().accessCodes as Array<{ code: string; displayName: string }>;

  for (let i = 0; i < joinKeys.length; i += 1) {
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code: codes[i]!.code, joinKey: joinKeys[i]! },
    });
    expect(joinRes.statusCode).toBe(200);
  }

  return { roomId: room.id, inviteToken: room.inviteToken };
}

describe("live room chat and moderation", () => {
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
    repository = createDrizzleRoomRepository(db, "Chat feature church");
    userRepository = createDrizzleUserRepository(db, "Chat feature church");
    await userRepository.insertUser({
      name: "Ada Admin",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });
    await userRepository.insertUser({
      name: "Membro",
      email: "member-chat@feature.test",
      passwordHash: await hashPassword(adminPassword),
      role: "member",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });
    const adminLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: adminEmail, password: adminPassword },
    });
    adminCookie = adminLogin.headers["set-cookie"]!.toString().split(";")[0]!;

    const memberLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "member-chat@feature.test", password: adminPassword },
    });
    memberCookie = memberLogin.headers["set-cookie"]!.toString().split(";")[0]!;
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    resetAuthAttempts();
    await db.delete(auditEvents);
    await db.delete(roomChatMessages);
    await db.delete(reactions);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
  });

  it("allows voters and admins to send messages and emotes while enforcing 2 msgs per 5s", async () => {
    const publishChatMessage = vi.fn();
    const presencePublisher: PresencePublisher = {
      publishPresence: vi.fn(),
      publishChatMessage,
    };
    const app = await buildApp({ roomRepository: repository, userRepository, presencePublisher });

    const { roomId, inviteToken } = await createAndJoinRoom(app, adminCookie, [
      "join-key-chat-1111",
      "join-key-chat-2222",
    ]);

    const msg1 = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/chat`,
      payload: { joinKey: "join-key-chat-1111", content: "Paz do Senhor! 👏" },
    });
    expect(msg1.statusCode).toBe(201);

    const msg2 = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/chat`,
      payload: { joinKey: "join-key-chat-1111", content: "🙏" },
    });
    expect(msg2.statusCode).toBe(201);

    // 3rd message within 5s for the same participant is rate-limited
    const msg3 = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/chat`,
      payload: { joinKey: "join-key-chat-1111", content: "Terceira seguida" },
    });
    expect(msg3.statusCode).toBe(429);
    expect(msg3.json().error).toBe("chat_rate_limited");

    // Second participant can still send immediately
    const otherVoter = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/chat`,
      payload: { joinKey: "join-key-chat-2222", content: "Amém!" },
    });
    expect(otherVoter.statusCode).toBe(201);

    // Admin can post to the live chat
    const adminMsg = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/chat`,
      headers: { cookie: adminCookie },
      payload: { content: "Atenção ao próximo escrutínio." },
    });
    expect(adminMsg.statusCode).toBe(201);
    expect(adminMsg.json().message.senderRole).toBe("admin");

    expect(publishChatMessage).toHaveBeenCalledTimes(4);

    const history = await app.inject({
      method: "GET",
      url: `/v1/join/${inviteToken}/chat`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toHaveLength(4);

    await app.close();
  });

  it("lets admin mute individual participants or the whole room while blocking non-admins", async () => {
    const publishChatConfig = vi.fn();
    const presencePublisher: PresencePublisher = {
      publishPresence: vi.fn(),
      publishChatConfig,
    };
    const app = await buildApp({ roomRepository: repository, userRepository, presencePublisher });

    const { roomId, inviteToken } = await createAndJoinRoom(app, adminCookie, [
      "join-key-mod-1111",
      "join-key-mod-2222",
    ]);

    const adminChat = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${roomId}/chat`,
      headers: { cookie: adminCookie },
    });
    expect(adminChat.statusCode).toBe(200);
    const participantsList = adminChat.json().participants as Array<{
      id: string;
      chatMuted: boolean;
    }>;
    expect(participantsList).toHaveLength(2);

    const targetId = participantsList[0]!.id;

    // Non-admin and unauth cannot access mute endpoints
    const unauthMute = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}/participants/${targetId}/mute`,
      payload: { chatMuted: true },
    });
    expect(unauthMute.statusCode).toBe(401);

    const memberMute = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}/participants/${targetId}/mute`,
      headers: { cookie: memberCookie },
      payload: { chatMuted: true },
    });
    expect(memberMute.statusCode).toBe(403);

    // Mute participant 1 only
    const muteOne = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}/participants/${targetId}/mute`,
      headers: { cookie: adminCookie },
      payload: { chatMuted: true },
    });
    expect(muteOne.statusCode).toBe(200);
    expect(muteOne.json().participant.chatMuted).toBe(true);

    const blockedVoter1 = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/chat`,
      payload: { joinKey: "join-key-mod-1111", content: "Oi" },
    });
    expect(blockedVoter1.statusCode).toBe(403);
    expect(blockedVoter1.json().error).toBe("participant_muted");

    const allowedVoter2 = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/chat`,
      payload: { joinKey: "join-key-mod-2222", content: "Ainda posso falar" },
    });
    expect(allowedVoter2.statusCode).toBe(201);

    // Mute entire room
    const muteRoom = await app.inject({
      method: "PATCH",
      url: `/v1/admin/rooms/${roomId}`,
      headers: { cookie: adminCookie },
      payload: { chatMuted: true },
    });
    expect(muteRoom.statusCode).toBe(200);
    expect(muteRoom.json().room.chatMuted).toBe(true);

    const blockedVoter2 = await app.inject({
      method: "POST",
      url: `/v1/join/${inviteToken}/chat`,
      payload: { joinKey: "join-key-mod-2222", content: "Agora bloqueado" },
    });
    expect(blockedVoter2.statusCode).toBe(403);
    expect(blockedVoter2.json().error).toBe("room_chat_muted");

    // Admin can still post while room is muted
    const adminWhileMuted = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/chat`,
      headers: { cookie: adminCookie },
      payload: { content: "Silêncio para votação." },
    });
    expect(adminWhileMuted.statusCode).toBe(201);

    await app.close();
  });
});
