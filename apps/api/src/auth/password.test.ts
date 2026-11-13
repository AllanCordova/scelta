import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("accepts the password that was hashed", async () => {
    const stored = await hashPassword("correct-horse");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct-horse", stored)).toBe(true);
  });

  it("rejects a different password and a tampered hash", async () => {
    const stored = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-horse", stored)).toBe(false);
    expect(await verifyPassword("correct-horse", `${stored}x`)).toBe(false);
    expect(await verifyPassword("correct-horse", "not-a-hash")).toBe(false);
  });
});
