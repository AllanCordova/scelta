import { createPgliteDatabase, sessions, users, type Db } from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_LOGIN_CLIENT_ATTEMPTS, resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { createSessionToken } from "../auth/session-cookie.js";
import { buildApp } from "../app.js";
import { ensureBootstrapAdmin } from "../users/bootstrap-admin.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

describe("account sessions", () => {
  let db: Db;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    userRepository = createDrizzleUserRepository(db, "Auth church");
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    resetAuthAttempts();
    await db.delete(sessions);
    await db.delete(users);
  });

  it("registers a member, rejects a client role, and keeps rules public", async () => {
    const app = await buildApp({ userRepository });

    const created = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "Mia",
        email: "Mia@Church.test",
        password: "senha-segura",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().user).toMatchObject({
      name: "Mia",
      email: "mia@church.test",
      role: "member",
    });
    expect(created.body).not.toContain("scrypt$");
    expect(created.body).not.toContain("senha-segura");
    expectSessionFlags(created.headers["set-cookie"]);
    const cookie = sessionCookie(created.headers["set-cookie"]);
    expect(cookie).toContain("scelta_session=");

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.role).toBe("member");

    const promoted = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        name: "Intruso",
        email: "intruso@church.test",
        password: "senha-segura",
        role: "admin",
      },
    });
    expect(promoted.statusCode).toBe(201);
    expect(promoted.json().user.role).toBe("member");
    expect(promoted.body).not.toContain("senha-segura");

    const intruder = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: sessionCookie(promoted.headers["set-cookie"]) },
      payload: {
        title: "Sala indevida",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
      },
    });
    expect(intruder.statusCode).toBe(403);

    const presets = await app.inject({ method: "GET", url: "/v1/rules/presets" });
    expect(presets.statusCode).toBe(200);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    await app.close();
  });

  it("logs in, logs out, and rejects a forged or expired session", async () => {
    const app = await buildApp({ userRepository });
    const passwordHash = await hashPassword("senha-segura");
    const user = await userRepository.insertUser({
      name: "Ada",
      email: "ada@church.test",
      passwordHash,
      role: "admin",
    });

    const wrong = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "ada@church.test", password: "outra-senha" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: "invalid_credentials" });
    expect(wrong.headers["set-cookie"]).toBeUndefined();

    const missing = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "ninguem@church.test", password: "senha-segura" },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: "invalid_credentials" });

    const loggedIn = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "Ada@Church.test", password: "senha-segura" },
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.json().user).toMatchObject({ email: "ada@church.test", role: "admin" });
    expect(loggedIn.body).not.toContain(passwordHash);
    expectSessionFlags(loggedIn.headers["set-cookie"]);
    const cookie = sessionCookie(loggedIn.headers["set-cookie"]);

    const forgedToken = createSessionToken();
    const forged = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: `scelta_session=${forgedToken}` },
      payload: {
        title: "Sala forjada",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
      },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json()).toEqual({ error: "unauthorized" });

    const expiredToken = createSessionToken();
    await userRepository.createSession(user.id, expiredToken, new Date(Date.now() - 1000));
    const expired = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: `scelta_session=${expiredToken}` },
      payload: {
        title: "Sala expirada",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
      },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({ error: "unauthorized" });

    const loggedOut = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { cookie },
    });
    expect(loggedOut.statusCode).toBe(204);
    expectSessionFlags(loggedOut.headers["set-cookie"], { cleared: true });

    const afterLogout = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie },
      payload: {
        title: "Sala depois da saída",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
      },
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json()).toEqual({ error: "unauthorized" });

    await app.close();
  });

  it("limits repeated login failures", async () => {
    const app = await buildApp({ userRepository });
    await userRepository.insertUser({
      name: "Ada",
      email: "ada@church.test",
      passwordHash: await hashPassword("senha-segura"),
      role: "admin",
    });
    await userRepository.insertUser({
      name: "Mia",
      email: "mia@church.test",
      passwordHash: await hashPassword("member-password"),
      role: "member",
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "ada@church.test", password: "errada" },
      });
      expect(response.statusCode).toBe(401);
    }

    const member = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "mia@church.test", password: "member-password" },
    });
    expect(member.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "ada@church.test", password: "senha-segura" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "rate_limited" });

    await app.close();
  });

  it("stops password checks when one client rotates emails", async () => {
    const app = await buildApp({ userRepository });

    for (let attempt = 0; attempt < MAX_LOGIN_CLIENT_ATTEMPTS; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: `guess-${attempt}@church.test`, password: "errada" },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "another-guess@church.test", password: "errada" },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "rate_limited" });

    await app.close();
  });

  it("creates a bootstrap admin once and does not promote an existing member", async () => {
    const app = await buildApp({ userRepository });
    await ensureBootstrapAdmin(userRepository, {
      name: "Administrador",
      email: "admin@church.test",
      password: "bootstrap-password",
    });
    await ensureBootstrapAdmin(userRepository, {
      name: "Administrador",
      email: "admin@church.test",
      password: "replacement-password",
    });

    const firstPassword = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@church.test", password: "bootstrap-password" },
    });
    expect(firstPassword.statusCode).toBe(200);
    expect(firstPassword.json().user.role).toBe("admin");

    const replaced = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "admin@church.test", password: "replacement-password" },
    });
    expect(replaced.statusCode).toBe(401);

    await userRepository.insertUser({
      name: "Mia",
      email: "mia@church.test",
      passwordHash: await hashPassword("member-password"),
      role: "member",
    });
    await ensureBootstrapAdmin(userRepository, {
      name: "Mia",
      email: "Mia@Church.test",
      password: "promoted-password",
    });

    const member = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "mia@church.test", password: "member-password" },
    });
    expect(member.statusCode).toBe(200);
    expect(member.json().user.role).toBe("member");

    await app.close();
  });
});

function expectSessionFlags(
  setCookie: string | string[] | undefined,
  options: { cleared?: boolean } = {},
) {
  const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Lax");
  expect(header).toContain("Path=/");
  if (options.cleared) {
    expect(header).toContain("Max-Age=0");
  }
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
  const match = /scelta_session=([^;]+)/.exec(header);
  const value = match?.[1];
  if (!value) {
    throw new Error(`Missing session cookie in ${header}`);
  }
  return `scelta_session=${value}`;
}
