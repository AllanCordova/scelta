import {
  ballots,
  candidates,
  createPgliteDatabase,
  members,
  participants,
  roomMemberCodes,
  rooms,
  rounds,
  voteReceipts,
  type Db,
} from "@scelta/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthAttempts } from "../auth/auth-attempts.js";
import { hashPassword } from "../auth/password.js";
import { buildApp } from "../app.js";
import { createDrizzleRoomRepository } from "../rooms/drizzle-room-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import { clearAuditEvents } from "../testing/database.js";
import { createDrizzleUserRepository } from "../users/drizzle-user-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const adminEmail = "ada-media@feature.test";
const adminPassword = "feature-admin-password";

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SAMPLE_PNG_DATA_URI = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;
const SAMPLE_JPEG_DATA_URI = `data:image/jpeg;base64,${SAMPLE_PNG_BASE64}`;

describe("media endpoints and lightweight ballot polling", () => {
  let db: Db;
  let repository: RoomRepository;
  let userRepository: UserRepository;
  let closeDatabase: () => Promise<void>;
  let adminCookie: string;

  beforeAll(async () => {
    const database = await createPgliteDatabase();
    db = database.db;
    closeDatabase = database.close;
    repository = createDrizzleRoomRepository(db, "Media feature church");
    userRepository = createDrizzleUserRepository(db, "Media feature church");
    await userRepository.insertUser({
      name: "Ada",
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });

    const app = await buildApp({ roomRepository: repository, userRepository });
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: adminEmail, password: adminPassword },
    });
    adminCookie = loginRes.headers["set-cookie"]!.toString().split(";")[0]!;
    await app.close();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    resetAuthAttempts();
    await clearAuditEvents(db);
    await db.delete(voteReceipts);
    await db.delete(ballots);
    await db.delete(rounds);
    await db.delete(candidates);
    await db.delete(participants);
    await db.delete(roomMemberCodes);
    await db.delete(rooms);
    await db.delete(members);
  });

  it("serves candidate photos and office banners with ETag/304 and omits base64 blobs from ballot polling", async () => {
    const app = await buildApp({ roomRepository: repository, userRepository });

    await repository.createMember({
      fullName: "Paulo Apóstolo",
      isCommunicant: true,
      isMale: true,
      birthDate: "1980-01-10",
      photoUrl: SAMPLE_PNG_DATA_URI,
    });
    await repository.createMember({
      fullName: "Silas",
      isCommunicant: true,
      isMale: true,
      birthDate: "1985-05-20",
      photoUrl: "https://example.com/silas.jpg",
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
      payload: {
        title: "Eleição com fotos",
        roomType: "elder",
        rulesPreset: "ipb_local_officers",
        quorumValue: 1,
        quorumUnit: "absolute",
        status: "open",
        candidates: ["Paulo Apóstolo", "Silas"],
      },
    });
    expect(created.statusCode).toBe(201);
    const room = created.json().room as {
      id: string;
      inviteToken: string;
      candidates: Array<{ id: string; displayName: string }>;
    };
    const paulo = room.candidates.find((c) => c.displayName === "Paulo Apóstolo")!;
    const silas = room.candidates.find((c) => c.displayName === "Silas")!;

    const bannerSave = await app.inject({
      method: "PUT",
      url: `/v1/admin/rooms/${room.id}/office-banner`,
      headers: { cookie: adminCookie },
      payload: { bannerUrl: SAMPLE_JPEG_DATA_URI },
    });
    expect(bannerSave.statusCode).toBe(200);

    const ballotRes = await app.inject({
      method: "GET",
      url: `/v1/join/${room.inviteToken}/ballot`,
    });
    expect(ballotRes.statusCode).toBe(200);
    expect(ballotRes.body).not.toContain("data:image/");

    // Admin room detail (2s polling) and room list also omit raw base64 blobs
    const adminRoomDetailRes = await app.inject({
      method: "GET",
      url: `/v1/admin/rooms/${room.id}`,
      headers: { cookie: adminCookie },
    });
    expect(adminRoomDetailRes.statusCode).toBe(200);
    expect(adminRoomDetailRes.body).not.toContain("data:image/");

    const adminRoomListRes = await app.inject({
      method: "GET",
      url: "/v1/admin/rooms",
      headers: { cookie: adminCookie },
    });
    expect(adminRoomListRes.statusCode).toBe(200);
    expect(adminRoomListRes.body).not.toContain("data:image/");

    const ballotBody = ballotRes.json() as {
      activeBannerUrl: string | null;
      officeBanners: Record<string, string>;
      candidates: Array<{ id: string; photoUrl: string | null }>;
    };

    const pauloPhotoUrl = ballotBody.candidates.find((c) => c.id === paulo.id)?.photoUrl;
    const silasPhotoUrl = ballotBody.candidates.find((c) => c.id === silas.id)?.photoUrl;
    expect(pauloPhotoUrl).toMatch(
      new RegExp(`^/v1/rooms/${room.id}/candidates/${paulo.id}/photo\\?v=[a-f0-9]{12}$`),
    );
    expect(silasPhotoUrl).toBe("https://example.com/silas.jpg");
    expect(ballotBody.activeBannerUrl).toMatch(
      new RegExp(`^/v1/rooms/${room.id}/banners/default\\?v=[a-f0-9]{12}$`),
    );
    expect(ballotBody.officeBanners.default).toBe(ballotBody.activeBannerUrl);

    // Fetch candidate photo binary
    const photoRes = await app.inject({
      method: "GET",
      url: pauloPhotoUrl!,
    });
    expect(photoRes.statusCode).toBe(200);
    expect(photoRes.headers["content-type"]).toBe("image/png");
    expect(photoRes.headers["cache-control"]).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    expect(photoRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(photoRes.headers.etag).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/);
    expect(photoRes.rawPayload.equals(Buffer.from(SAMPLE_PNG_BASE64, "base64"))).toBe(true);

    // 304 Not Modified when If-None-Match matches
    const cachedPhotoRes = await app.inject({
      method: "GET",
      url: pauloPhotoUrl!,
      headers: { "if-none-match": photoRes.headers.etag as string },
    });
    expect(cachedPhotoRes.statusCode).toBe(304);
    expect(cachedPhotoRes.body).toBe("");

    // 200 when If-None-Match does not match
    const stalePhotoRes = await app.inject({
      method: "GET",
      url: pauloPhotoUrl!,
      headers: { "if-none-match": '"sha256-stale"' },
    });
    expect(stalePhotoRes.statusCode).toBe(200);

    // External URL candidate redirects
    const redirectRes = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.id}/candidates/${silas.id}/photo`,
    });
    expect(redirectRes.statusCode).toBe(302);
    expect(redirectRes.headers.location).toBe("https://example.com/silas.jpg");

    // Fetch office banner binary + 304
    const bannerRes = await app.inject({
      method: "GET",
      url: ballotBody.activeBannerUrl!,
    });
    expect(bannerRes.statusCode).toBe(200);
    expect(bannerRes.headers["content-type"]).toBe("image/jpeg");
    expect(bannerRes.headers.etag).toBeTruthy();

    const cachedBannerRes = await app.inject({
      method: "GET",
      url: ballotBody.activeBannerUrl!,
      headers: { "if-none-match": bannerRes.headers.etag as string },
    });
    expect(cachedBannerRes.statusCode).toBe(304);

    // Missing media returns 404
    const missingBanner = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.id}/banners/NonExistent`,
    });
    expect(missingBanner.statusCode).toBe(404);

    await app.close();
  });
});
