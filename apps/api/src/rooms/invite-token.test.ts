import { describe, expect, it } from "vitest";
import { createInviteToken } from "./invite-token.js";

describe("createInviteToken", () => {
  it("returns a url-safe token with 256 bits of randomness", () => {
    const token = createInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("does not repeat across draws", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => createInviteToken()));
    expect(tokens.size).toBe(20);
  });
});
