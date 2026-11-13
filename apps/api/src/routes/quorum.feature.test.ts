import {
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
import type { PresenceSnapshot } from "../realtime.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-quorum@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-quorum@feature.test";
const memberPassword = "feature-member-password";

describe("quorum gate", () => {
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
    repository = createDrizzleRoomRepository(db, "Quorum feature church");
    userRepository = createDrizzleUserRepository(db, "Quorum feature church");
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
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
  });

  it("reports presence against absolute and percent quorum", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const absolute = await createRoom(app, {
      title: "Absoluto",
      quorumValue: 5,
      quorumUnit: "absolute",
      eligibleCount: 100,
    });
    const percent = await createRoom(app, {
      title: "Percentual",
      quorumValue: 34,
      quorumUnit: "percent",
      eligibleCount: 10,
    });
    const empty = await createRoom(app, {
      title: "Sem lista",
      quorumValue: 34,
      quorumUnit: "percent",
    });

    expect(await presence(app, absolute.id)).toEqual({
      presentCount: 0,
      eligibleCount: 100,
      requiredCount: 5,
      quorumMet: false,
    });
    expect(await presence(app, percent.id)).toEqual({
      presentCount: 0,
      eligibleCount: 10,
      requiredCount: 4,
      quorumMet: false,
    });
    expect(await presence(app, empty.id)).toEqual({
      presentCount: 0,
      eligibleCount: 0,
      requiredCount: 0,
      quorumMet: false,
    });

    await app.close();
  });

  it("rejects opening below quorum, closes below quorum as failed_quorum if presence drops, and refuses to publish a winner", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, {
      title: "Abaixo",
      quorumValue: 4,
      quorumUnit: "absolute",
      eligibleCount: 100,
    });

    const blockedOpen = await openRound(app, room.id);
    expect(blockedOpen.statusCode).toBe(409);
    expect(blockedOpen.json()).toEqual({ error: "quorum_not_met" });

    await join(app, room.inviteToken, "Ana", "join-key-ana-0001");
    await join(app, room.inviteToken, "Bia", "join-key-bia-0002");
    await join(app, room.inviteToken, "Caio", "join-key-caio-0003");
    await join(app, room.inviteToken, "Davi", "join-key-davi-0004");

    const opened = await openRound(app, room.id);
    expect(opened.statusCode).toBe(201);
    const roundId = opened.json().round.id as string;

    await db.update(participants).set({ isPresent: false }).where(eq(participants.roomId, room.id));

    const closed = await closeRound(app, room.id, roundId);
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({
      round: { id: roundId, number: 1, status: "closed", outcome: "failed_quorum" },
      quorum: { presentCount: 0, eligibleCount: 100, requiredCount: 4, quorumMet: false },
    });

    const again = await closeRound(app, room.id, roundId);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "round_not_open" });

    const published = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/publish`,
      headers: { cookie: adminCookie, "content-type": "application/json" },
      payload: { winnerId: "candidate-1" },
    });
    expect(published.statusCode).toBe(409);
    expect(published.json()).toEqual({ error: "failed_quorum" });
    expect(published.body).not.toContain("candidate-1");

    await db.update(participants).set({ isPresent: true }).where(eq(participants.roomId, room.id));

    const next = await openRound(app, room.id);
    expect(next.statusCode).toBe(201);
    const nextRoundId = next.json().round.id as string;
    expect(next.json().round).toMatchObject({ number: 2, status: "open", outcome: null });

    const stillBlocked = await publish(app, room.id);
    expect(stillBlocked.statusCode).toBe(409);
    expect(stillBlocked.json()).toEqual({ error: "failed_quorum" });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });
    expect(listed.json().rooms).toEqual([
      expect.objectContaining({
        id: room.id,
        round: { id: nextRoundId, number: 2, status: "open", outcome: null },
      }),
    ]);

    for (const joinKey of [
      "join-key-ana-0001",
      "join-key-bia-0002",
      "join-key-caio-0003",
      "join-key-davi-0004",
    ]) {
      const ballot = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey, candidateId: null },
      });
      expect(ballot.statusCode).toBe(201);
    }

    const closedSecond = await closeRound(app, room.id, nextRoundId);
    expect(closedSecond.statusCode).toBe(200);
    expect(closedSecond.json()).toMatchObject({
      round: { id: nextRoundId, number: 2, status: "closed", outcome: "no_majority" },
      quorum: { presentCount: 4, eligibleCount: 100, requiredCount: 4, quorumMet: true },
    });

    await db.update(rounds).set({ outcome: "elected" }).where(eq(rounds.id, nextRoundId));
    const electedLater = await publish(app, room.id);
    expect(electedLater.statusCode).toBe(200);
    expect(electedLater.json()).toEqual({ published: true, roundId: nextRoundId, outcome: "elected" });
    expect(await db.select().from(ballots)).toHaveLength(4);

    await app.close();
  });

  it("rejects opening a percent quorum when the eligible list is empty", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const room = await createRoom(app, {
      title: "Percentual sem aptos",
      quorumValue: 34,
      quorumUnit: "percent",
    });
    await join(app, room.inviteToken, "Ana", "join-key-ana-0001");
    await join(app, room.inviteToken, "Bia", "join-key-bia-0002");

    const opened = await openRound(app, room.id);
    expect(opened.statusCode).toBe(409);
    expect(opened.json()).toEqual({ error: "quorum_not_met" });

    await app.close();
  });

  it("closes a met quorum without electing a winner", async () => {
    const events: PresenceSnapshot[] = [];
    const app = await buildApp({
      roomRepository: repository,
      userRepository,
      presencePublisher: {
        publishPresence(_roomId, snapshot) {
          events.push(snapshot);
        },
      },
    });
    const room = await createRoom(app, {
      title: "Quórum atingido",
      quorumValue: 50,
      quorumUnit: "percent",
      eligibleCount: 3,
    });

    await join(app, room.inviteToken, "Ana", "join-key-ana-0001");
    await join(app, room.inviteToken, "Bia", "join-key-bia-0002");
    expect(events).toEqual([
      { presentCount: 1, eligibleCount: 3, requiredCount: 2, quorumMet: false },
      { presentCount: 2, eligibleCount: 3, requiredCount: 2, quorumMet: true },
    ]);

    const opened = await openRound(app, room.id);
    const roundId = opened.json().round.id as string;
    for (const joinKey of ["join-key-ana-0001", "join-key-bia-0002"]) {
      const ballot = await app.inject({
        method: "POST",
        url: `/v1/join/${room.inviteToken}/ballot`,
        payload: { joinKey, candidateId: null },
      });
      expect(ballot.statusCode).toBe(201);
    }
    const closed = await closeRound(app, room.id, roundId);
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      round: { id: roundId, number: 1, status: "closed", outcome: "no_majority" },
      quorum: { presentCount: 2, eligibleCount: 3, requiredCount: 2, quorumMet: true },
    });

    const pending = await publish(app, room.id);
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toEqual({ error: "winner_not_elected" });

    await db.update(rounds).set({ outcome: "no_majority" }).where(eq(rounds.id, roundId));
    const noMajority = await publish(app, room.id);
    expect(noMajority.statusCode).toBe(409);
    expect(noMajority.json()).toEqual({ error: "winner_not_elected" });

    await db.update(rounds).set({ outcome: "elected" }).where(eq(rounds.id, roundId));
    const elected = await publish(app, room.id);
    expect(elected.statusCode).toBe(200);
    expect(elected.json()).toEqual({ published: true, roundId, outcome: "elected" });
    expect(await db.select().from(ballots)).toHaveLength(2);

    await app.close();
  });

  it("opens a round only for an open room and only one at a time", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });
    const draft = await createRoom(app, {
      title: "Rascunho",
      status: "draft",
      quorumValue: 2,
      quorumUnit: "absolute",
    });
    const denied = await openRound(app, draft.id);
    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toEqual({ error: "room_not_open" });

    const room = await createRoom(app, {
      title: "Aberta",
      quorumValue: 2,
      quorumUnit: "absolute",
    });
    await join(app, room.inviteToken, "Ana", "join-key-ana-0001");
    await join(app, room.inviteToken, "Bia", "join-key-bia-0002");
    await db.update(rooms).set({ status: "voting" }).where(eq(rooms.id, room.id));

    const opened = await openRound(app, room.id);
    expect(opened.statusCode).toBe(201);
    const duplicate = await openRound(app, room.id);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({ error: "round_already_open" });

    const missingRound = await closeRound(app, room.id, "00000000-0000-4000-8000-000000000000");
    expect(missingRound.statusCode).toBe(404);
    expect(missingRound.json()).toEqual({ error: "round_not_found" });

    const missingRoom = await openRound(app, "00000000-0000-4000-8000-000000000000");
    expect(missingRoom.statusCode).toBe(404);
    expect(missingRoom.json()).toEqual({ error: "room_not_found" });

    const member = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: memberCookie },
    });
    expect(member.statusCode).toBe(403);
    expect(member.json()).toEqual({ error: "forbidden" });

    const anonymous = await publish(app, room.id, null);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: "unauthorized" });

    const stored = await db.select().from(rounds);
    expect(stored.filter((row) => row.status === "open")).toHaveLength(1);

    await app.close();
  });

  async function createRoom(
    app: Awaited<ReturnType<typeof buildApp>>,
    input: {
      title: string;
      quorumValue: number;
      quorumUnit: "absolute" | "percent";
      eligibleCount?: number;
      status?: "draft" | "open";
    },
  ) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: input.title,
        roomType: "elder",
        rulesPreset: "custom",
        status: input.status ?? "open",
        quorumValue: input.quorumValue,
        quorumUnit: input.quorumUnit,
        candidates: ["Paulo", "Silas"],
        ...(input.eligibleCount === undefined ? {} : { eligibleCount: input.eligibleCount }),
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().room as { id: string; inviteToken: string };
  }

  async function presence(app: Awaited<ReturnType<typeof buildApp>>, roomId: string) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${roomId}/presence`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
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

  function publish(
    app: Awaited<ReturnType<typeof buildApp>>,
    roomId: string,
    cookie: string | null = adminCookie,
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${roomId}/publish`,
      headers: cookie ? { cookie } : {},
    });
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
  return sessionCookie(response.headers["set-cookie"]);
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
  const match = /scelta_session=([^;]+)/.exec(header);
  const value = match?.[1];
  if (!value) {
    throw new Error("Missing session cookie");
  }
  return `scelta_session=${value}`;
}
