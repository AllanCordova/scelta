import { beforeEach, describe, expect, it } from "vitest";
import {
  ENTRY_CONFIRM_RATE_LIMIT,
  isRateLimited,
  recordRateLimitHit,
  resetRateLimits,
  ROSTER_SEARCH_RATE_LIMIT,
  takeRateLimitSlot,
  type RateLimitPolicy,
} from "./rate-limiter.js";

const policy: RateLimitPolicy = { name: "test", limit: 2, windowMs: 1000 };

describe("sliding-window rate limiter", () => {
  beforeEach(() => resetRateLimits());

  it("blocks after the limit and frees slots as the window slides", () => {
    expect(takeRateLimitSlot(policy, "a", 0)).toBe(true);
    expect(takeRateLimitSlot(policy, "a", 400)).toBe(true);
    expect(takeRateLimitSlot(policy, "a", 800)).toBe(false);
    expect(takeRateLimitSlot(policy, "a", 1001)).toBe(true);
    expect(takeRateLimitSlot(policy, "a", 1100)).toBe(false);
  });

  it("keeps subjects and policies independent", () => {
    takeRateLimitSlot(policy, "a", 0);
    takeRateLimitSlot(policy, "a", 1);
    expect(takeRateLimitSlot(policy, "b", 2)).toBe(true);
    expect(takeRateLimitSlot({ ...policy, name: "other" }, "a", 2)).toBe(true);
  });

  it("enforces separate buckets for roster search and entry confirmation limits", () => {
    for (let i = 0; i < ENTRY_CONFIRM_RATE_LIMIT.limit; i += 1) {
      recordRateLimitHit(ENTRY_CONFIRM_RATE_LIMIT, "ip:room-1", 1000 + i);
    }
    expect(isRateLimited(ENTRY_CONFIRM_RATE_LIMIT, "ip:room-1", 2000)).toBe(true);
    expect(isRateLimited(ROSTER_SEARCH_RATE_LIMIT, "ip:room-1", 2000)).toBe(false);
  });
});
