import { describe, expect, it } from "vitest";
import {
  createJoinKey,
  isJoinKey,
  readJoinIdentity,
  writeJoinIdentity,
  type StoredJoinIdentity,
} from "./join-identity";

describe("join identity", () => {
  it("creates a key the server will accept", () => {
    const joinKey = createJoinKey();
    expect(isJoinKey(joinKey)).toBe(true);
    expect(joinKey).toHaveLength(43);
    expect(createJoinKey()).not.toBe(joinKey);
  });

  it("round-trips a stored identity per invite token", () => {
    const storage = memoryStorage();
    const identity: StoredJoinIdentity = {
      joinKey: "a".repeat(32),
      displayName: "Ana",
    };

    writeJoinIdentity(storage, "token-a", identity);
    writeJoinIdentity(storage, "token-b", { joinKey: "b".repeat(32), displayName: "Bia" });

    expect(readJoinIdentity(storage, "token-a")).toEqual(identity);
    expect(readJoinIdentity(storage, "missing")).toBeNull();
  });

  it("ignores corrupt storage", () => {
    const storage = memoryStorage();
    storage.setItem("scelta.join.token", "{");
    expect(readJoinIdentity(storage, "token")).toBeNull();

    storage.setItem("scelta.join.token", JSON.stringify({ displayName: "Ana" }));
    expect(readJoinIdentity(storage, "token")).toBeNull();
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
