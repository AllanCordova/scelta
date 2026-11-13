import { describe, expect, it } from "vitest";
import {
  clearLoginAccountAttempts,
  isClientLimited,
  MAX_LOGIN_CLIENT_ATTEMPTS,
  recordClientAttempt,
  releaseLoginAttempt,
  releaseLoginClientAttempt,
  resetAuthAttempts,
  takeLoginAttempt,
  takeLoginClientAttempt,
} from "./auth-attempts.js";

describe("auth attempt limits", () => {
  it("reserves login guesses per account before verification", () => {
    resetAuthAttempts();
    const now = 1_000;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(takeLoginAttempt("ada@church.test", now)).toBe(true);
    }

    expect(takeLoginAttempt("ada@church.test", now)).toBe(false);
    expect(takeLoginAttempt("mia@church.test", now)).toBe(true);

    clearLoginAccountAttempts("mia@church.test");
    expect(takeLoginAttempt("ada@church.test", now)).toBe(false);

    clearLoginAccountAttempts("ada@church.test");
    expect(takeLoginAttempt("ada@church.test", now)).toBe(true);
  });

  it("caps password checks per client even when the email changes", () => {
    resetAuthAttempts();
    const now = 1_000;
    for (let attempt = 0; attempt < MAX_LOGIN_CLIENT_ATTEMPTS; attempt += 1) {
      expect(takeLoginClientAttempt("10.0.0.8", now)).toBe(true);
    }

    expect(takeLoginClientAttempt("10.0.0.8", now)).toBe(false);
    expect(takeLoginClientAttempt("10.0.0.9", now)).toBe(true);
    expect(takeLoginAttempt("fresh@church.test", now)).toBe(true);

    releaseLoginClientAttempt("10.0.0.8", now);
    expect(takeLoginClientAttempt("10.0.0.8", now)).toBe(true);
  });

  it("returns a reserved login guess when verification did not run", () => {
    resetAuthAttempts();
    const now = 1_000;
    expect(takeLoginAttempt("ada@church.test", now)).toBe(true);
    releaseLoginAttempt("ada@church.test", now);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(takeLoginAttempt("ada@church.test", now)).toBe(true);
    }
    expect(takeLoginAttempt("ada@church.test", now)).toBe(false);
  });

  it("does not let a login failure consume the register budget", () => {
    resetAuthAttempts();
    recordClientAttempt("login", "10.0.0.8", 1_000);
    expect(isClientLimited("register", "10.0.0.8", 1_000)).toBe(false);
  });
});
