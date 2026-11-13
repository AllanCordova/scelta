import { createHash } from "node:crypto";

/** The raw join key stays on the client. Presence dedup uses this digest. */
export function hashJoinKey(joinKey: string): string {
  return createHash("sha256").update(joinKey, "utf8").digest("hex");
}
