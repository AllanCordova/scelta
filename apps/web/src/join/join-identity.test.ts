import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredAccessCode,
  createJoinKey,
  hasAccessCodeInSearch,
  isJoinKey,
  readAccessCodeFromSearch,
  readJoinIdentity,
  shortCodeStorageKey,
  stripAccessCodeFromUrl,
  writeJoinIdentity,
  type StoredJoinIdentity,
} from "./join-identity";

describe("join identity", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("creates a key the server will accept", () => {
    const joinKey = createJoinKey();
    expect(isJoinKey(joinKey)).toBe(true);
    expect(joinKey).toHaveLength(43);
    expect(createJoinKey()).not.toBe(joinKey);
  });

  it("round-trips a stored identity per invite token or short code", () => {
    const storage = memoryStorage();
    const identity: StoredJoinIdentity = {
      joinKey: "a".repeat(32),
      displayName: "Ana",
      accessCode: "A7K9M2",
    };

    writeJoinIdentity(storage, "token-a", identity);
    writeJoinIdentity(storage, shortCodeStorageKey("k7m-2p9"), {
      joinKey: "b".repeat(32),
      displayName: "Bia",
      accessCode: "B8L3N4",
    });

    expect(readJoinIdentity(storage, "token-a")).toEqual(identity);
    expect(readJoinIdentity(storage, "s.K7M2P9")).toEqual({
      joinKey: "b".repeat(32),
      displayName: "Bia",
      accessCode: "B8L3N4",
    });
    expect(readJoinIdentity(storage, "missing")).toBeNull();
  });

  it("clears only accessCode and displayName while preserving joinKey", () => {
    const storage = memoryStorage();
    writeJoinIdentity(storage, "token-a", {
      joinKey: "a".repeat(32),
      displayName: "Ana",
      accessCode: "A7K9M2",
    });

    clearStoredAccessCode(storage, "token-a");
    expect(readJoinIdentity(storage, "token-a")).toEqual({
      joinKey: "a".repeat(32),
      displayName: "",
    });
  });

  it("reads ?c= first and falls back to ?code=", () => {
    expect(readAccessCodeFromSearch("?c=a7k9m2&code=b8l3n4")).toBe("A7K9M2");
    expect(readAccessCodeFromSearch("?code=%20b8l3n4%20")).toBe("B8L3N4");
    expect(readAccessCodeFromSearch("?other=1")).toBe("");
    expect(hasAccessCodeInSearch("?c=A7K9M2")).toBe(true);
    expect(hasAccessCodeInSearch("?code=A7K9M2")).toBe(true);
    expect(hasAccessCodeInSearch("?foo=bar")).toBe(false);
  });

  it("strips ?c= and ?code= via history.replaceState", () => {
    window.history.replaceState(null, "", "/s/K7M2P9?c=A7K9M2");
    const spy = vi.spyOn(window.history, "replaceState");

    stripAccessCodeFromUrl();

    expect(spy).toHaveBeenCalledWith(null, "", "/s/K7M2P9");
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/s/K7M2P9");
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
