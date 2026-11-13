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

const adminEmail = "ada-members@feature.test";
const adminPassword = "feature-admin-password";
const memberEmail = "mia-members@feature.test";
const memberPassword = "feature-member-password";

describe("member roll import and listing", () => {
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
    repository = createDrizzleRoomRepository(db, "Members feature church");
    userRepository = createDrizzleUserRepository(db, "Members feature church");
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

  it("imports valid rows, reports rejected rows with line numbers, and updates existing members on re-import", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const firstCsv = [
      "nome,comungante,sexo,data_nascimento,upa_ativo,upa_ingresso",
      "Paulo Apóstolo,sim,M,1985-04-12,nao,",
      "Lídia de Tiatira,sim,F,2004-09-20,sim,2024-01-15",
      ",sim,M,1990-01-01,nao,",
      "Timóteo Jovem,talvez,M,2006-05-10,sim,2025-02-01",
      "Barnabé Consolador,sim,M,1990-02-30,nao,",
    ].join("\n");

    const firstImport = await app.inject({
      method: "POST",
      url: "/v1/admin/members/import",
      headers: { cookie: adminCookie },
      payload: { csv: firstCsv },
    });
    expect(firstImport.statusCode).toBe(200);
    expect(firstImport.json()).toEqual({
      report: {
        createdCount: 2,
        updatedCount: 0,
        rejectedCount: 3,
        rejectedRows: [
          { line: 4, reason: "missing_name" },
          { line: 5, reason: "invalid_communicant" },
          { line: 6, reason: "invalid_birth_date" },
        ],
      },
    });

    // Re-import updating Lídia's attributes (case-insensitive match) and adding Silas
    const secondCsv = [
      "full_name;is_communicant;gender;birth_date;upa_active;upa_enrolled_at",
      "lídia de tiatira;nao;F;2004-09-20;sim;2023-06-01",
      "Silas Companheiro;sim;M;1992-11-03;nao;",
    ].join("\n");

    const secondImport = await app.inject({
      method: "POST",
      url: "/v1/admin/members/import",
      headers: { cookie: adminCookie },
      payload: { csv: secondCsv },
    });
    expect(secondImport.statusCode).toBe(200);
    expect(secondImport.json()).toEqual({
      report: {
        createdCount: 1,
        updatedCount: 1,
        rejectedCount: 0,
        rejectedRows: [],
      },
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/members",
      headers: { cookie: adminCookie },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().members).toEqual([
      {
        id: expect.any(String),
        fullName: "Paulo Apóstolo",
        isCommunicant: true,
        isMale: true,
        birthDate: "1985-04-12",
        societyFlags: {
          upaActive: false,
        },
      },
      {
        id: expect.any(String),
        fullName: "Silas Companheiro",
        isCommunicant: true,
        isMale: true,
        birthDate: "1992-11-03",
        societyFlags: {
          upaActive: false,
        },
      },
      {
        id: expect.any(String),
        fullName: "lídia de tiatira",
        isCommunicant: false,
        isMale: false,
        birthDate: "2004-09-20",
        societyFlags: {
          upaActive: true,
          upaEnrolledAt: "2023-06-01",
        },
      },
    ]);

    await app.close();
  });

  it("enforces admin authorization and rejects empty imports", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    const unauthenticatedImport = await app.inject({
      method: "POST",
      url: "/v1/admin/members/import",
      payload: { csv: "Paulo,sim,M,1980-01-01" },
    });
    expect(unauthenticatedImport.statusCode).toBe(401);

    const memberImport = await app.inject({
      method: "POST",
      url: "/v1/admin/members/import",
      headers: { cookie: memberCookie },
      payload: { csv: "Paulo,sim,M,1980-01-01" },
    });
    expect(memberImport.statusCode).toBe(403);

    const unauthenticatedList = await app.inject({
      method: "GET",
      url: "/v1/admin/members",
    });
    expect(unauthenticatedList.statusCode).toBe(401);

    const memberList = await app.inject({
      method: "GET",
      url: "/v1/admin/members",
      headers: { cookie: memberCookie },
    });
    expect(memberList.statusCode).toBe(403);

    const headerOnlyImport = await app.inject({
      method: "POST",
      url: "/v1/admin/members/import",
      headers: { cookie: adminCookie },
      payload: { csv: "nome,comungante,sexo,data_nascimento\n   \n" },
    });
    expect(headerOnlyImport.statusCode).toBe(400);
    expect(headerOnlyImport.json()).toEqual({ error: "empty_import" });

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
