import { describe, expect, it } from "vitest";
import { createBallotToken } from "./ballot-token.js";

describe("createBallotToken", () => {
  it("returns an unguessable url-safe token per ballot", () => {
    const token = createBallotToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const tokens = new Set(Array.from({ length: 20 }, () => createBallotToken()));
    expect(tokens.size).toBe(20);
  });
});
