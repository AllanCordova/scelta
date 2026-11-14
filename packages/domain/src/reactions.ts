export const ALLOWED_REACTION_EMOJIS = ["👏", "🙏", "❤️", "👍", "🎉"] as const;

export type AllowedReactionEmoji = (typeof ALLOWED_REACTION_EMOJIS)[number];

export const REACTION_RATE_LIMIT_MAX = 5;
export const REACTION_RATE_LIMIT_WINDOW_MS = 10_000;

const ALLOWED_SET = new Set<string>(ALLOWED_REACTION_EMOJIS);

export function isReactionEmojiAllowed(emoji: string): emoji is AllowedReactionEmoji {
  return ALLOWED_SET.has(emoji);
}

export function isReactionRateLimited(
  recentCount: number,
  maxPerWindow = REACTION_RATE_LIMIT_MAX,
): boolean {
  return recentCount >= maxPerWindow;
}
