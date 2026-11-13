import {
  auditEvents,
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
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

const adminEmail = "ada-suggestions@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-suggestions@feature.test";
const memberPassword = "feature-member-password";

describe("candidate suggestions by room type", () => {
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
    repository = createDrizzleRoomRepository(db, "Suggestions feature church");
    userRepository = createDrizzleUserRepository(db, "Suggestions feature church");
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
    await db.delete(auditEvents);
    await db.delete(ballots);
    await db.delete(voteReceipts);
    await db.delete(candidates);
    await db.delete(rounds);
    await db.delete(participants);
    await db.delete(members);
    await db.delete(rooms);
  });

  it("suggests candidates matching CI/IPB officer filters and UPA society seniority rules, and blocks ineligible members on room creation", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const csv = [
      "nome,comungante,sexo,data_nascimento,upa_ativo,upa_ingresso",
      "Paulo Apóstolo,sim,M,1985-04-12,nao,",
      "Silas Companheiro,sim,M,1998-06-01,sim,2024-01-10",
      "Timóteo Menor,sim,M,2012-09-15,sim,2026-08-01",
      "Lídia de Tiatira,sim,F,1995-03-20,sim,2023-05-01",
      "Febe de Cencreia,nao,F,1990-11-02,nao,",
    ].join("\n");

    const imported = await app.inject({
      method: "POST",
      url: "/v1/admin/members/import",
      headers: { cookie: adminCookie },
      payload: { csv },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().report.createdCount).toBe(5);

    // Elder room (CI/IPB: communicant men >= 18) -> Paulo and Silas
    const elderSuggestions = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=elder&referenceDate=2026-11-13",
      headers: { cookie: adminCookie },
    });
    expect(elderSuggestions.statusCode).toBe(200);
    expect(elderSuggestions.json().suggestions).toEqual([
      { memberId: expect.any(String), fullName: "Paulo Apóstolo" },
      { memberId: expect.any(String), fullName: "Silas Companheiro" },
    ]);

    // Deacon room with configurable minAgeYears=35 -> only Paulo
    const deaconCustomAge = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=deacon&referenceDate=2026-11-13&minAgeYears=35",
      headers: { cookie: adminCookie },
    });
    expect(deaconCustomAge.statusCode).toBe(200);
    expect(deaconCustomAge.json().suggestions).toEqual([
      { memberId: expect.any(String), fullName: "Paulo Apóstolo" },
    ]);

    // UPA board room (active + >= 6 months seniority) -> Lídia and Silas (Timóteo has only 3 months)
    const upaSuggestions = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=upa_board&referenceDate=2026-11-13",
      headers: { cookie: adminCookie },
    });
    expect(upaSuggestions.statusCode).toBe(200);
    expect(upaSuggestions.json().suggestions).toEqual([
      { memberId: expect.any(String), fullName: "Lídia de Tiatira" },
      { memberId: expect.any(String), fullName: "Silas Companheiro" },
    ]);

    // Creating an elder room with an ineligible member from the roll (Lídia or Timóteo) is rejected
    const rejectedRoom = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição de presbíteros inválida",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        status: "open",
        quorumValue: 2,
        quorumUnit: "absolute",
        candidates: ["Paulo Apóstolo", "Lídia de Tiatira"],
      },
    });
    expect(rejectedRoom.statusCode).toBe(400);
    expect(rejectedRoom.json()).toEqual({
      error: "invalid_room",
      details: [{ field: "candidates", code: "invalid" }],
    });

    // Creating an elder room with eligible suggested candidates succeeds
    const validRoom = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição de presbíteros válida",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        status: "open",
        quorumValue: 2,
        quorumUnit: "absolute",
        candidates: ["Paulo Apóstolo", "Silas Companheiro"],
      },
    });
    expect(validRoom.statusCode).toBe(201);
    expect(validRoom.json().room.candidates).toEqual([
      { id: expect.any(String), displayName: "Paulo Apóstolo" },
      { id: expect.any(String), displayName: "Silas Companheiro" },
    ]);

    await app.close();
  });

  it("enforces admin authorization and validates referenceDate on suggestions endpoint", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=elder",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const memberAttempt = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=elder",
      headers: { cookie: memberCookie },
    });
    expect(memberAttempt.statusCode).toBe(403);

    const badReferenceDate = await app.inject({
      method: "GET",
      url: "/v1/admin/members/suggestions?roomType=elder&referenceDate=2026-02-30",
      headers: { cookie: adminCookie },
    });
    expect(badReferenceDate.statusCode).toBe(400);
    expect(badReferenceDate.json()).toEqual({ error: "invalid_reference_date" });

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
  const setCookie = response.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
  const match = /scelta_session=([^;]+)/.exec(header);
  const value = match?.[1];
  if (!value) {
    throw new Error("Missing session cookie");
  }
  return `scelta_session=${value}`;
}
