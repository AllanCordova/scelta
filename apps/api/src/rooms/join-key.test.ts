import { describe, expect, it } from "vitest";
import { hashJoinKey } from "./join-key.js";

describe("hashJoinKey", () => {
  it("stores a stable sha256 digest and not the key", () => {
    const digest = hashJoinKey("join-key-example");

    expect(digest).toBe("5aa814baaa906a32c714c1fe6bd77f5012456f4068bcd779aaefe965313b9a15");
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain("join-key-example");
    expect(hashJoinKey("join-key-example")).toBe(digest);
    expect(hashJoinKey("join-key-other")).not.toBe(digest);
  });
});
