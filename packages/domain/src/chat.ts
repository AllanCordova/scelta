export const CHAT_RATE_LIMIT_MAX = 2;
export const CHAT_RATE_LIMIT_WINDOW_MS = 5_000;
export const CHAT_MESSAGE_MAX_LENGTH = 280;

export type ValidateChatMessageResult =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "too_long" };

export function validateChatMessage(raw: string): ValidateChatMessageResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, text: trimmed };
}

export function isChatRateLimited(
  recentCount: number,
  maxPerWindow = CHAT_RATE_LIMIT_MAX,
): boolean {
  return recentCount >= maxPerWindow;
}
