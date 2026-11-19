import { afterEach, describe, expect, it, vi } from "vitest";
import { displayShortRoomUrl, shortRoomUrl } from "./admin/room-draft";
import { fetchPublicConfig, hasOriginMismatch, resolvePublicOrigin } from "./config-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPublicConfig", () => {
  it("fetches /v1/config and normalizes trailing slashes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ publicUrl: "https://vote.igreja.org/" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPublicConfig()).resolves.toEqual({
      publicUrl: "https://vote.igreja.org",
    });
    expect(fetchMock).toHaveBeenCalledWith("/v1/config", { cache: "no-store" });
  });

  it("returns null publicUrl when unset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ publicUrl: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(fetchPublicConfig()).resolves.toEqual({ publicUrl: null });
  });

  it("throws when the config endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(fetchPublicConfig()).rejects.toThrow("config_fetch_failed_500");
  });
});

describe("resolvePublicOrigin", () => {
  it("uses normalized publicUrl when configured", () => {
    expect(resolvePublicOrigin("https://vote.igreja.org///", "http://localhost:5173")).toBe(
      "https://vote.igreja.org",
    );
  });

  it("falls back to normalized currentOrigin when publicUrl is null or empty", () => {
    expect(resolvePublicOrigin(null, "http://localhost:5173/")).toBe("http://localhost:5173");
    expect(resolvePublicOrigin("   ", "http://192.168.1.20:5173/")).toBe(
      "http://192.168.1.20:5173",
    );
  });
});

describe("hasOriginMismatch", () => {
  it("returns false when publicUrl is unset", () => {
    expect(hasOriginMismatch(null, "http://localhost:5173")).toBe(false);
    expect(hasOriginMismatch("", "http://localhost:5173")).toBe(false);
  });

  it("returns false when origins match even with trailing slashes or subpaths", () => {
    expect(hasOriginMismatch("https://vote.igreja.org/", "https://vote.igreja.org")).toBe(false);
    expect(hasOriginMismatch("https://vote.igreja.org/scelta", "https://vote.igreja.org")).toBe(
      false,
    );
  });

  it("returns true when origins differ", () => {
    expect(hasOriginMismatch("https://vote.igreja.org", "http://localhost:5173")).toBe(true);
    expect(hasOriginMismatch("http://192.168.1.50:5173", "http://localhost:5173")).toBe(true);
    expect(hasOriginMismatch("https://vote.igreja.org", "http://vote.igreja.org")).toBe(true);
  });
});

describe("shortRoomUrl and displayShortRoomUrl", () => {
  it("builds short room URLs with and without an access code", () => {
    expect(shortRoomUrl("https://vote.igreja.org/", "AB12")).toBe(
      "https://vote.igreja.org/s/AB12",
    );
    expect(shortRoomUrl("https://vote.igreja.org/", "AB12", "48 29")).toBe(
      "https://vote.igreja.org/s/AB12?c=48%2029",
    );
    expect(shortRoomUrl("https://vote.igreja.org", "AB12", "   ")).toBe(
      "https://vote.igreja.org/s/AB12",
    );
  });

  it("strips protocol for displayShortRoomUrl", () => {
    expect(displayShortRoomUrl("https://vote.igreja.org/", "AB12", "4829")).toBe(
      "vote.igreja.org/s/AB12?c=4829",
    );
    expect(displayShortRoomUrl("http://192.168.1.50:5173", "AB12")).toBe(
      "192.168.1.50:5173/s/AB12",
    );
  });
});
