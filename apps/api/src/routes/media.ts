import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { RoomRepository } from "../rooms/room-repository.js";

const DATA_IMAGE_URI_PATTERN =
  /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i;

const MEDIA_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});

const CandidatePhotoParams = Type.Object({
  roomId: Uuid,
  candidateId: Uuid,
});

const BannerParams = Type.Object({
  roomId: Uuid,
  officeKey: Type.String({ minLength: 1, maxLength: 200 }),
});

export type MediaRouteOptions = {
  roomRepository?: RoomRepository;
};

export type ParsedDataImage = {
  mimeType: string;
  buffer: Buffer;
};

/** Parses an inline base64 image data URI into a MIME type and binary buffer. */
export function parseDataImageUri(value: string): ParsedDataImage | null {
  const match = DATA_IMAGE_URI_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const rawMime = match[1]!.toLowerCase();
  const mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const buffer = Buffer.from(match[2]!, "base64");
  if (buffer.length === 0) {
    return null;
  }

  return { mimeType, buffer };
}

/** Computes a short content hash for cache-busting media URLs. */
export function computeMediaVersion(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** Replaces inline candidate data URIs with a cacheable media endpoint URL. */
export function toCandidatePhotoUrl(
  roomId: string,
  candidateId: string,
  photoUrl: string | null | undefined,
): string | null {
  if (!photoUrl) {
    return null;
  }
  const trimmed = photoUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith("data:")) {
    return `/v1/rooms/${encodeURIComponent(roomId)}/candidates/${encodeURIComponent(candidateId)}/photo?v=${computeMediaVersion(trimmed)}`;
  }
  return trimmed;
}

/** Replaces inline office banner data URIs with a cacheable media endpoint URL. */
export function toOfficeBannerUrl(
  roomId: string,
  officeKey: string,
  bannerUrl: string | null | undefined,
): string | null {
  if (!bannerUrl) {
    return null;
  }
  const trimmed = bannerUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith("data:")) {
    return `/v1/rooms/${encodeURIComponent(roomId)}/banners/${encodeURIComponent(officeKey)}?v=${computeMediaVersion(trimmed)}`;
  }
  return trimmed;
}

/** Transforms a room's officeBanners map so inline data URIs become lightweight URLs. */
export function toPublicOfficeBanners(
  roomId: string,
  officeBanners: Record<string, string> | undefined,
): Record<string, string> {
  if (!officeBanners) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [officeKey, bannerUrl] of Object.entries(officeBanners)) {
    const publicUrl = toOfficeBannerUrl(roomId, officeKey, bannerUrl);
    if (publicUrl) {
      result[officeKey] = publicUrl;
    }
  }
  return result;
}

/** Checks whether an HTTP If-None-Match header matches the current strong ETag. */
export function matchesIfNoneMatch(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (!raw) {
    return false;
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

function sendMediaValue(request: FastifyRequest, reply: FastifyReply, rawValue: string) {
  const value = rawValue.trim();
  if (value.startsWith("data:")) {
    const parsed = parseDataImageUri(value);
    if (!parsed) {
      return reply.code(404).send({ error: "media_not_found" });
    }

    const etag = `"sha256-${createHash("sha256").update(parsed.buffer).digest("base64url")}"`;
    reply.header("cache-control", MEDIA_CACHE_CONTROL);
    reply.header("etag", etag);
    reply.header("x-content-type-options", "nosniff");

    if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
      return reply.code(304).send();
    }

    return reply.type(parsed.mimeType).send(parsed.buffer);
  }

  if (/^https?:\/\//i.test(value)) {
    return reply.redirect(value, 302);
  }

  return reply.code(404).send({ error: "media_not_found" });
}

export const mediaRoutes: FastifyPluginAsync<MediaRouteOptions> = async (app, options) => {
  app.get(
    "/v1/rooms/:roomId/candidates/:candidateId/photo",
    { schema: { params: CandidatePhotoParams } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, candidateId } = request.params as {
        roomId: string;
        candidateId: string;
      };

      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const candidates = await repository.listAllCandidates(roomId);
        const candidate = candidates.find((item) => item.id === candidateId);
        if (!candidate?.photoUrl) {
          return reply.code(404).send({ error: "media_not_found" });
        }

        return sendMediaValue(request, reply, candidate.photoUrl);
      } catch (error) {
        request.log.error({ err: error }, "Failed to serve candidate photo");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/rooms/:roomId/banners/:officeKey",
    { schema: { params: BannerParams } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, officeKey } = request.params as {
        roomId: string;
        officeKey: string;
      };

      try {
        const room = await repository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const bannerUrl = room.officeBanners?.[officeKey];
        if (!bannerUrl) {
          return reply.code(404).send({ error: "media_not_found" });
        }

        return sendMediaValue(request, reply, bannerUrl);
      } catch (error) {
        request.log.error({ err: error }, "Failed to serve office banner");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};
