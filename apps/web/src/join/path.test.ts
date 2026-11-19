import { describe, expect, it } from "vitest";
import {
  joinTargetFromPath,
  joinTokenFromPath,
  normalizeRoomShortCode,
  shortCodeFromPath,
} from "./path";

describe("joinTokenFromPath", () => {
  it("reads the invite token and ignores other pages", () => {
    expect(joinTokenFromPath("/join/exemplo")).toBe("exemplo");
    expect(joinTokenFromPath("/join/abc_def-123/")).toBe("abc_def-123");
    expect(joinTokenFromPath("/join/a%2Fhidden")).toBe("a/hidden");
    expect(joinTokenFromPath("/join")).toBeNull();
    expect(joinTokenFromPath("/join/")).toBeNull();
    expect(joinTokenFromPath("/admin")).toBeNull();
  });
});

describe("shortCodeFromPath", () => {
  it("extracts and normalizes room short codes", () => {
    expect(shortCodeFromPath("/s/k7m2p9")).toBe("K7M2P9");
    expect(shortCodeFromPath("/s/k7m-2p9/")).toBe("K7M2P9");
    expect(shortCodeFromPath("/s/%20k7m%202p9%20")).toBe("K7M2P9");
    expect(shortCodeFromPath("/s")).toBeNull();
    expect(shortCodeFromPath("/s/")).toBeNull();
    expect(shortCodeFromPath("/s/---")).toBeNull();
    expect(shortCodeFromPath("/join/token")).toBeNull();
  });
});

describe("joinTargetFromPath", () => {
  it("resolves token or short code routes", () => {
    expect(joinTargetFromPath("/join/abc-123")).toEqual({ mode: "token", token: "abc-123" });
    expect(joinTargetFromPath("/s/k7m-2p9")).toEqual({ mode: "shortCode", shortCode: "K7M2P9" });
    expect(joinTargetFromPath("/")).toBeNull();
    expect(joinTargetFromPath("/admin/salas")).toBeNull();
  });

  it("normalizes short code strings", () => {
    expect(normalizeRoomShortCode("  k7m-2p 9 ")).toBe("K7M2P9");
  });
});
