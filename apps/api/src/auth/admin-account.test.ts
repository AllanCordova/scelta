import { describe, expect, it } from "vitest";
import { assertAdminAccountConfig } from "./admin-account.js";

describe("assertAdminAccountConfig", () => {
  it("allows the example password outside production", () => {
    expect(() => assertAdminAccountConfig("development", "admin@igreja.local", "dev-admin-password")).not.toThrow();
    expect(() => assertAdminAccountConfig("development", undefined, undefined)).not.toThrow();
  });

  it("rejects a missing pair, the example password, and a short password in production", () => {
    expect(() => assertAdminAccountConfig("production", "admin@igreja.local", undefined)).toThrow(/both be set/);
    expect(() => assertAdminAccountConfig("production", undefined, undefined)).toThrow(/required in production/);
    expect(() => assertAdminAccountConfig("production", "admin@igreja.local", "dev-admin-password")).toThrow(
      /12 characters/,
    );
    expect(() => assertAdminAccountConfig("production", "admin@igreja.local", "x".repeat(11))).toThrow(
      /12 characters/,
    );
    expect(() =>
      assertAdminAccountConfig("production", "admin@igreja.local", "x".repeat(12)),
    ).not.toThrow();
  });
});
