import {
  auditEvents,
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
  roomMemberCodes,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-banner@feature.test";
const adminPassword = "feature-admin-password";

describe("admin-only cargo banner images", () => {
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
    repository = createDrizzleRoomRepository(db, "Banner feature church");
    userRepository = createDrizzleUserRepository(db, "Banner feature church");
    await userRepository.insertUser({
      name: "Ada",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });
    await userRepository.insertUser({
      name: "Votante",
      email: "voter-banner@feature.test",
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
      payload: { email: "voter-banner@feature.test", password: adminPassword },
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
    await db.delete(voteReceipts);
    await db.delete(ballots);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("allows only admins to set and remove a single-office cargo banner", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição de Presbíteros",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Paulo", "Silas"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as { id: string; inviteToken: string };

    const unauth = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      payload: { bannerUrl: "https://example.com/elder-banner.png" },
    });
    expect(unauth.statusCode).toBe(401);

    const nonAdmin = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: memberCookie },
      payload: { bannerUrl: "https://example.com/elder-banner.png" },
    });
    expect(nonAdmin.statusCode).toBe(403);

    const invalidUrl = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: adminCookie },
      payload: { bannerUrl: "javascript:alert(1)" },
    });
    expect(invalidUrl.statusCode).toBe(400);

    const saved = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: adminCookie },
      payload: { bannerUrl: "https://example.com/elder-banner.png" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().room.officeBanners).toEqual({
      default: "https://example.com/elder-banner.png",
    });

    const ballotBefore = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotBefore.statusCode).toBe(200);
    expect(ballotBefore.json().activeBannerUrl).toBe("https://example.com/elder-banner.png");

    const removed = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: adminCookie },
      payload: { bannerUrl: null },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().room.officeBanners).toEqual({});

    await app.close();
  });

  it("supports one banner per cargo in multi-office rooms and exposes the active cargo banner on the ballot", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Diretoria UPA",
        roomType: "upa_board",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Ana", "Bia"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as { id: string; inviteToken: string };

    const invalidOffice = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: adminCookie },
      payload: {
        officeLabel: "Cargo Inexistente",
        bannerUrl: "https://example.com/none.png",
      },
    });
    expect(invalidOffice.statusCode).toBe(400);

    const setPresidente = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: adminCookie },
      payload: {
        officeLabel: "Presidente",
        bannerUrl: "https://example.com/presidente-banner.png",
      },
    });
    expect(setPresidente.statusCode).toBe(200);

    const setTesoureiro = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: adminCookie },
      payload: {
        officeLabel: "Tesoureiro",
        bannerUrl: "https://example.com/tesoureiro-banner.png",
      },
    });
    expect(setTesoureiro.statusCode).toBe(200);
    expect(setTesoureiro.json().room.officeBanners).toEqual({
      Presidente: "https://example.com/presidente-banner.png",
      Tesoureiro: "https://example.com/tesoureiro-banner.png",
    });

    const simCodes = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/access-codes/simulate`,
      headers: { cookie: adminCookie },
      payload: { count: 1 },
    });
    expect(simCodes.statusCode).toBe(200);
    const code = simCodes.json().accessCodes[0]!.code as string;

    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/join/${room.inviteToken}`,
      payload: { code, joinKey: "join-key-banner-001" },
    });
    expect(joinRes.statusCode).toBe(200);

    const openTesoureiro = await app.inject({
      method: "POST",
      url: `/v1/admin/rooms/${room.id}/rounds`,
      headers: { cookie: adminCookie },
      payload: { officeLabel: "Tesoureiro" },
    });
    expect(openTesoureiro.statusCode).toBe(201);

    const ballotRes = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotRes.statusCode).toBe(200);
    expect(ballotRes.json().activeBannerUrl).toBe("https://example.com/tesoureiro-banner.png");
    expect(
      ballotRes.json().offices.find((o: { officeLabel: string }) => o.officeLabel === "Presidente")
        ?.bannerUrl,
    ).toBe("https://example.com/presidente-banner.png");

    await app.close();
  });
});
