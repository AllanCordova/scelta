import { describe, expect, it } from "vitest";
import {
  clearSessionCookieHeader,
  createSessionToken,
  hashSessionToken,
  readSessionToken,
  sessionCookieHeader,
} from "./session-cookie.js";

describe("session cookies", () => {
  it("stores only a hash of the token", () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("reads the session cookie and ignores unrelated cookies", () => {
    const token = "abc.def-123";
    expect(readSessionToken(`theme=light; scelta_session=${token}; other=1`)).toBe(token);
    expect(readSessionToken(undefined)).toBeUndefined();
    expect(readSessionToken("theme=light")).toBeUndefined();
  });

  it("marks the cookie HttpOnly and SameSite=Lax", () => {
    const header = sessionCookieHeader("token", false);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Secure");

    const secure = sessionCookieHeader("token", true);
    expect(secure).toContain("Secure");
    expect(clearSessionCookieHeader(false)).toContain("Max-Age=0");
  });
});
