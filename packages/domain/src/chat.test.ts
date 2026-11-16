import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_WINDOW_MS,
  isChatRateLimited,
  validateChatMessage,
} from "./chat.js";

describe("live room chat rules", () => {
  it("enforces 2 messages per 5 seconds rate limit", () => {
    expect(CHAT_RATE_LIMIT_MAX).toBe(2);
    expect(CHAT_RATE_LIMIT_WINDOW_MS).toBe(5_000);
    expect(isChatRateLimited(0)).toBe(false);
    expect(isChatRateLimited(1)).toBe(false);
    expect(isChatRateLimited(2)).toBe(true);
    expect(isChatRateLimited(3)).toBe(true);
  });

  it("validates chat message text and length", () => {
    expect(validateChatMessage("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateChatMessage("  Amém 👏  ")).toEqual({ ok: true, text: "Amém 👏" });
    expect(validateChatMessage("a".repeat(CHAT_MESSAGE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});
