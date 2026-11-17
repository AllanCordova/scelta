import type { FastifyReply, FastifyRequest } from "fastify";

export type RateLimitPolicy = {
  /** Namespace that keeps buckets of different endpoints apart. */
  name: string;
  limit: number;
  windowMs: number;
};

export const JOIN_RATE_LIMIT: RateLimitPolicy = { name: "join", limit: 20, windowMs: 60_000 };
export const JOIN_BURST_RATE_LIMIT: RateLimitPolicy = {
  name: "join-burst",
  limit: 300,
  windowMs: 60_000,
};
export const BALLOT_RATE_LIMIT: RateLimitPolicy = { name: "ballot", limit: 30, windowMs: 60_000 };
export const BALLOT_BURST_RATE_LIMIT: RateLimitPolicy = {
  name: "ballot-burst",
  limit: 300,
  windowMs: 60_000,
};
export const CHAT_REQUEST_RATE_LIMIT: RateLimitPolicy = { name: "chat", limit: 30, windowMs: 60_000 };
export const CHAT_BURST_RATE_LIMIT: RateLimitPolicy = {
  name: "chat-burst",
  limit: 300,
  windowMs: 60_000,
};

const MAX_TRACKED_KEYS = 50_000;

const hits = new Map<string, number[]>();

/** Returns true when the subject has already exhausted its quota in the current window. */
export function isRateLimited(
  policy: RateLimitPolicy,
  subject: string,
  now = Date.now(),
): boolean {
  const key = `${policy.name}:${subject}`;
  const windowStart = now - policy.windowMs;
  const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  hits.set(key, recent);
  return recent.length >= policy.limit;
}

/** Records a hit for the subject without checking the limit. */
export function recordRateLimitHit(
  policy: RateLimitPolicy,
  subject: string,
  now = Date.now(),
): void {
  const key = `${policy.name}:${subject}`;
  const windowStart = now - policy.windowMs;
  const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  recent.push(now);
  hits.set(key, recent);
  pruneIfOversized(windowStart);
}

/**
 * Sliding-window check. Records the hit when allowed.
 * Returns false when the key already used its quota inside the window.
 */
export function takeRateLimitSlot(
  policy: RateLimitPolicy,
  subject: string,
  now = Date.now(),
): boolean {
  if (isRateLimited(policy, subject, now)) {
    return false;
  }

  recordRateLimitHit(policy, subject, now);
  return true;
}

export function resetRateLimits(): void {
  hits.clear();
}

export async function replyRateLimited(
  reply: FastifyReply,
  policy: RateLimitPolicy,
): Promise<void> {
  await reply
    .code(429)
    .header("retry-after", String(Math.ceil(policy.windowMs / 1000)))
    .send({ error: "rate_limited", message: "Muitas tentativas. Aguarde um instante e tente de novo." });
}

/** Applies the policy to a request; replies 429 and returns false when exceeded. */
export async function enforceRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  policy: RateLimitPolicy,
  scope: string,
): Promise<boolean> {
  if (takeRateLimitSlot(policy, `${request.ip || "unknown"}:${scope}`)) {
    return true;
  }

  await replyRateLimited(reply, policy);
  return false;
}

function pruneIfOversized(windowStart: number): void {
  if (hits.size <= MAX_TRACKED_KEYS) {
    return;
  }

  for (const [key, timestamps] of hits) {
    const last = timestamps[timestamps.length - 1];
    if (last === undefined || last <= windowStart) {
      hits.delete(key);
    }
  }
}
