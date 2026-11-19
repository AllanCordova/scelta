import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { normalizePublicUrl } from "../env.js";

describe("config feature", () => {
  it("returns null publicUrl without auth when PUBLIC_URL is unset", async () => {
    const app = await buildApp({ publicUrl: null });

    const response = await app.inject({
      method: "GET",
      url: "/v1/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicUrl: null });

    await app.close();
  });

  it("returns normalized publicUrl with trailing slashes stripped", async () => {
    const app = await buildApp({ publicUrl: "https://vote.igreja.org///" });

    const response = await app.inject({
      method: "GET",
      url: "/v1/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicUrl: "https://vote.igreja.org" });

    await app.close();
  });

  it("preserves port and subpath while stripping trailing slashes", async () => {
    const app = await buildApp({ publicUrl: "http://192.168.1.50:5173/scelta/" });

    const response = await app.inject({
      method: "GET",
      url: "/v1/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicUrl: "http://192.168.1.50:5173/scelta" });

    await app.close();
  });
});

describe("normalizePublicUrl", () => {
  it("returns null when unset or blank", () => {
    expect(normalizePublicUrl(undefined)).toBeNull();
    expect(normalizePublicUrl(null)).toBeNull();
    expect(normalizePublicUrl("")).toBeNull();
    expect(normalizePublicUrl("   ")).toBeNull();
  });

  it("normalizes valid http and https URLs", () => {
    expect(normalizePublicUrl("  https://vote.igreja.org/  ")).toBe("https://vote.igreja.org");
    expect(normalizePublicUrl("http://localhost:5173///")).toBe("http://localhost:5173");
  });

  it("rejects invalid URLs and non-http(s) protocols", () => {
    expect(() => normalizePublicUrl("not-a-url")).toThrow(/Invalid PUBLIC_URL/);
    expect(() => normalizePublicUrl("ftp://vote.igreja.org")).toThrow(/http:\/\/ or https:\/\//);
    expect(() => normalizePublicUrl("javascript:alert(1)")).toThrow(/http:\/\/ or https:\/\//);
  });
});
