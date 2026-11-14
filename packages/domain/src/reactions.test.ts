import { describe, expect, it } from "vitest";
import {
  ALLOWED_REACTION_EMOJIS,
  isReactionEmojiAllowed,
  isReactionRateLimited,
  REACTION_RATE_LIMIT_MAX,
} from "./reactions.js";

describe("reactions domain rules", () => {
  it("accepts allowlisted emojis and rejects arbitrary strings or other emojis", () => {
    for (const emoji of ALLOWED_REACTION_EMOJIS) {
      expect(isReactionEmojiAllowed(emoji)).toBe(true);
    }
    expect(isReactionEmojiAllowed("💣")).toBe(false);
    expect(isReactionEmojiAllowed("Candidate A")).toBe(false);
    expect(isReactionEmojiAllowed("")).toBe(false);
  });

  it("enforces the rate limit threshold", () => {
    expect(isReactionRateLimited(0)).toBe(false);
    expect(isReactionRateLimited(REACTION_RATE_LIMIT_MAX - 1)).toBe(false);
    expect(isReactionRateLimited(REACTION_RATE_LIMIT_MAX)).toBe(true);
    expect(isReactionRateLimited(REACTION_RATE_LIMIT_MAX + 2)).toBe(true);
    expect(isReactionRateLimited(1, 2)).toBe(false);
    expect(isReactionRateLimited(2, 2)).toBe(true);
    expect(isReactionRateLimited(0, 0)).toBe(true);
  });
});
