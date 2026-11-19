import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import {
  computeMediaVersion,
  matchesIfNoneMatch,
  parseDataImageUri,
  toCandidatePhotoUrl,
  toOfficeBannerUrl,
  toPublicOfficeBanners,
} from "./media.js";

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SAMPLE_PNG_DATA_URI = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;

describe("media helpers", () => {
  it("parses valid image data URIs and rejects unsupported or empty payloads", () => {
    const png = parseDataImageUri(SAMPLE_PNG_DATA_URI);
    expect(png).not.toBeNull();
    expect(png?.mimeType).toBe("image/png");
    expect(png?.buffer.equals(Buffer.from(SAMPLE_PNG_BASE64, "base64"))).toBe(true);

    const jpg = parseDataImageUri(`data:image/jpg;base64,${SAMPLE_PNG_BASE64}`);
    expect(jpg?.mimeType).toBe("image/jpeg");

    expect(parseDataImageUri("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(parseDataImageUri("data:image/png;base64,")).toBeNull();
    expect(parseDataImageUri("https://example.com/photo.png")).toBeNull();
  });

  it("converts inline data URIs to versioned media URLs and preserves external URLs", () => {
    const roomId = "11111111-1111-4111-8111-111111111111";
    const candidateId = "22222222-2222-4222-8222-222222222222";
    const version = computeMediaVersion(SAMPLE_PNG_DATA_URI);

    expect(toCandidatePhotoUrl(roomId, candidateId, SAMPLE_PNG_DATA_URI)).toBe(
      `/v1/rooms/${roomId}/candidates/${candidateId}/photo?v=${version}`,
    );
    expect(toCandidatePhotoUrl(roomId, candidateId, "https://example.com/a.jpg")).toBe(
      "https://example.com/a.jpg",
    );
    expect(toCandidatePhotoUrl(roomId, candidateId, null)).toBeNull();
    expect(toCandidatePhotoUrl(roomId, candidateId, "   ")).toBeNull();

    expect(toOfficeBannerUrl(roomId, "Presidente UPA", SAMPLE_PNG_DATA_URI)).toBe(
      `/v1/rooms/${roomId}/banners/Presidente%20UPA?v=${version}`,
    );
    expect(toPublicOfficeBanners(roomId, {
      default: SAMPLE_PNG_DATA_URI,
      Presbítero: "https://example.com/banner.png",
    })).toEqual({
      default: `/v1/rooms/${roomId}/banners/default?v=${version}`,
      Presbítero: "https://example.com/banner.png",
    });
  });

  it("matches If-None-Match headers against strong ETags", () => {
    const etag = '"sha256-abc123"';
    expect(matchesIfNoneMatch(etag, etag)).toBe(true);
    expect(matchesIfNoneMatch(`W/${etag}`, etag)).toBe(true);
    expect(matchesIfNoneMatch(`"other", ${etag}`, etag)).toBe(true);
    expect(matchesIfNoneMatch("*", etag)).toBe(true);
    expect(matchesIfNoneMatch('"sha256-different"', etag)).toBe(false);
    expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
  });

  it("returns 503 when roomRepository is not configured", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/rooms/11111111-1111-4111-8111-111111111111/candidates/22222222-2222-4222-8222-222222222222/photo",
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "persistence_unavailable" });
    await app.close();
  });
});
