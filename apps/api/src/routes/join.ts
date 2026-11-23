import {
  canJoinRoom,
  normalizeRoomShortCode,
  normalizeRosterSearchQuery,
  resolveRoomMaxParticipants,
  validateAccessCodeJoin,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PresencePublisher, PresenceSnapshot } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import { quorumStatus } from "../rooms/quorum-status.js";
import type { RoomRepository, StoredRoom } from "../rooms/room-repository.js";
import {
  enforceRateLimit,
  ENTRY_CONFIRM_BURST_RATE_LIMIT,
  ENTRY_CONFIRM_RATE_LIMIT,
  isRateLimited,
  JOIN_BURST_RATE_LIMIT,
  JOIN_RATE_LIMIT,
  recordRateLimitHit,
  replyRateLimited,
  ROSTER_SEARCH_BURST_RATE_LIMIT,
  ROSTER_SEARCH_RATE_LIMIT,
} from "../security/rate-limiter.js";

const JOIN_KEY_MIN_LENGTH = 16;
const JOIN_KEY_MAX_LENGTH = 128;
const JOIN_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});

const TokenParams = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 200 }),
});

const ShortCodeParams = Type.Object({
  shortCode: Type.String({ minLength: 1, maxLength: 32 }),
});

const TokenRequestIdParams = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 200 }),
  requestId: Uuid,
});

const ShortCodeRequestIdParams = Type.Object({
  shortCode: Type.String({ minLength: 1, maxLength: 32 }),
  requestId: Uuid,
});

const RosterSearchQuery = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 100 })),
  },
  { additionalProperties: false },
);

const JoinBody = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 32 }),
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

const SubmitEntryRequestBody = Type.Object(
  {
    rosterEntryId: Uuid,
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
    birthDay: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 31 }), Type.Null()])),
    birthMonth: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 12 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

type JoinBodyType = {
  code: string;
  joinKey: string;
};

type SubmitEntryRequestBodyType = {
  rosterEntryId: string;
  joinKey: string;
  birthDay?: number | null;
  birthMonth?: number | null;
};

export type JoinRouteOptions = {
  roomRepository?: RoomRepository;
  presencePublisher?: PresencePublisher;
};

export const joinRoutes: FastifyPluginAsync<JoinRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.get("/v1/join/:token", { schema: { params: TokenParams } }, async (request, reply) => {
    const repository = options.roomRepository;
    if (!repository) {
      return reply.code(503).send({ error: "persistence_unavailable" });
    }

    const { token } = request.params as { token: string };
    try {
      const room = await repository.findRoomByInviteToken(token);
      if (!room) {
        return reply.code(404).send({ error: "invite_not_found" });
      }

      const presentCount = await loadTotalPresentCount(repository, room.id);
      return {
        title: room.title,
        status: room.status,
        canJoin: canJoinRoom(room.status),
        entryMode: room.entryMode,
        entryOpen: room.entryOpen,
        maxParticipants: resolveRoomMaxParticipants(room),
        presentCount,
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to preview invite");
      return reply.code(500).send({ error: "persistence_failed" });
    }
  });

  app.get(
    "/v1/join/s/:shortCode",
    { schema: { params: ShortCodeParams } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getJoinRoomByShortCode) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { shortCode } = request.params as { shortCode: string };
      const normalizedShortCode = normalizeRoomShortCode(shortCode);
      try {
        const room = await repository.getJoinRoomByShortCode(normalizedShortCode);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        const presentCount = await loadTotalPresentCount(repository, room.id);
        return {
          title: room.title,
          status: room.status,
          shortCode: room.shortCode,
          canJoin: canJoinRoom(room.status),
          entryMode: room.entryMode,
          entryOpen: room.entryOpen,
          maxParticipants: resolveRoomMaxParticipants(room),
          presentCount,
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to preview room by short code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/:token",
    { schema: { params: TokenParams, body: JoinBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const failureScope = `${request.ip || "unknown"}:${token}`;
      if (!(await enforceRateLimit(request, reply, JOIN_BURST_RATE_LIMIT, token))) {
        return;
      }
      if (isRateLimited(JOIN_RATE_LIMIT, failureScope)) {
        await replyRateLimited(reply, JOIN_RATE_LIMIT);
        return;
      }

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        const result = await completeRoomJoin({
          request,
          reply,
          repository,
          presencePublisher: options.presencePublisher,
          room,
          body: request.body as JoinBodyType,
          failureScope,
        });
        if (!result) {
          return;
        }

        return {
          title: room.title,
          status: room.status,
          displayName: result.displayName,
          presentCount: result.presentCount,
          alreadyJoined: result.alreadyJoined,
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to join room");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/s/:shortCode",
    { schema: { params: ShortCodeParams, body: JoinBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getJoinRoomByShortCode) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { shortCode } = request.params as { shortCode: string };
      const normalizedShortCode = normalizeRoomShortCode(shortCode);
      const rateScope = `s:${normalizedShortCode || shortCode.trim()}`;
      const ip = request.ip || "unknown";
      const failureScope = `${ip}:${rateScope}`;
      const missScope = `${ip}:short-code-miss`;

      if (!(await enforceRateLimit(request, reply, JOIN_BURST_RATE_LIMIT, rateScope))) {
        return;
      }
      if (isRateLimited(JOIN_RATE_LIMIT, failureScope) || isRateLimited(JOIN_RATE_LIMIT, missScope)) {
        await replyRateLimited(reply, JOIN_RATE_LIMIT);
        return;
      }

      try {
        const room = await repository.getJoinRoomByShortCode(normalizedShortCode);
        if (!room) {
          recordRateLimitHit(JOIN_RATE_LIMIT, missScope);
          return reply.code(404).send({ error: "invite_not_found" });
        }

        const result = await completeRoomJoin({
          request,
          reply,
          repository,
          presencePublisher: options.presencePublisher,
          room,
          body: request.body as JoinBodyType,
          failureScope,
        });
        if (!result) {
          return;
        }

        return {
          title: room.title,
          status: room.status,
          shortCode: room.shortCode,
          inviteToken: room.inviteToken,
          displayName: result.displayName,
          presentCount: result.presentCount,
          alreadyJoined: result.alreadyJoined,
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to join room by short code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/join/:token/roster-search",
    { schema: { params: TokenParams, querystring: RosterSearchQuery } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.searchRoomRoster) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const { q } = (request.query ?? {}) as { q?: string };
      if (
        !(await enforceRateLimit(request, reply, ROSTER_SEARCH_BURST_RATE_LIMIT, token)) ||
        !(await enforceRateLimit(request, reply, ROSTER_SEARCH_RATE_LIMIT, token))
      ) {
        return;
      }

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        return await handleRosterSearch({ reply, repository, room, rawQuery: q });
      } catch (error) {
        request.log.error({ err: error }, "Failed to search room roster");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/join/s/:shortCode/roster-search",
    { schema: { params: ShortCodeParams, querystring: RosterSearchQuery } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getJoinRoomByShortCode || !repository.searchRoomRoster) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { shortCode } = request.params as { shortCode: string };
      const { q } = (request.query ?? {}) as { q?: string };
      const normalizedShortCode = normalizeRoomShortCode(shortCode);
      const rateScope = `s:${normalizedShortCode || shortCode.trim()}`;
      const ip = request.ip || "unknown";
      const missScope = `${ip}:short-code-search-miss`;

      if (
        !(await enforceRateLimit(request, reply, ROSTER_SEARCH_BURST_RATE_LIMIT, rateScope)) ||
        !(await enforceRateLimit(request, reply, ROSTER_SEARCH_RATE_LIMIT, rateScope))
      ) {
        return;
      }
      if (isRateLimited(ROSTER_SEARCH_RATE_LIMIT, missScope)) {
        await replyRateLimited(reply, ROSTER_SEARCH_RATE_LIMIT);
        return;
      }

      try {
        const room = await repository.getJoinRoomByShortCode(normalizedShortCode);
        if (!room) {
          recordRateLimitHit(ROSTER_SEARCH_RATE_LIMIT, missScope);
          return reply.code(404).send({ error: "invite_not_found" });
        }

        return await handleRosterSearch({ reply, repository, room, rawQuery: q });
      } catch (error) {
        request.log.error({ err: error }, "Failed to search room roster by short code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/:token/entry-requests",
    { schema: { params: TokenParams, body: SubmitEntryRequestBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.submitEntryRequest) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const failureScope = `${request.ip || "unknown"}:${token}`;
      if (!(await enforceRateLimit(request, reply, ENTRY_CONFIRM_BURST_RATE_LIMIT, token))) {
        return;
      }
      if (isRateLimited(ENTRY_CONFIRM_RATE_LIMIT, failureScope)) {
        await replyRateLimited(reply, ENTRY_CONFIRM_RATE_LIMIT);
        return;
      }

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        return await handleSubmitEntryRequest({
          request,
          reply,
          repository,
          presencePublisher: options.presencePublisher,
          room,
          body: request.body as SubmitEntryRequestBodyType,
          failureScope,
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to submit entry request");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/s/:shortCode/entry-requests",
    { schema: { params: ShortCodeParams, body: SubmitEntryRequestBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getJoinRoomByShortCode || !repository.submitEntryRequest) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { shortCode } = request.params as { shortCode: string };
      const normalizedShortCode = normalizeRoomShortCode(shortCode);
      const rateScope = `s:${normalizedShortCode || shortCode.trim()}`;
      const ip = request.ip || "unknown";
      const failureScope = `${ip}:${rateScope}`;
      const missScope = `${ip}:short-code-entry-miss`;

      if (!(await enforceRateLimit(request, reply, ENTRY_CONFIRM_BURST_RATE_LIMIT, rateScope))) {
        return;
      }
      if (
        isRateLimited(ENTRY_CONFIRM_RATE_LIMIT, failureScope) ||
        isRateLimited(ENTRY_CONFIRM_RATE_LIMIT, missScope)
      ) {
        await replyRateLimited(reply, ENTRY_CONFIRM_RATE_LIMIT);
        return;
      }

      try {
        const room = await repository.getJoinRoomByShortCode(normalizedShortCode);
        if (!room) {
          recordRateLimitHit(ENTRY_CONFIRM_RATE_LIMIT, missScope);
          return reply.code(404).send({ error: "invite_not_found" });
        }

        return await handleSubmitEntryRequest({
          request,
          reply,
          repository,
          presencePublisher: options.presencePublisher,
          room,
          body: request.body as SubmitEntryRequestBodyType,
          failureScope,
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to submit entry request by short code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/join/:token/entry-requests/:requestId",
    { schema: { params: TokenRequestIdParams } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getEntryRequestStatus) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token, requestId } = request.params as { token: string; requestId: string };
      const joinKey = readJoinKeyHeader(request);
      if (!joinKey) {
        return reply.code(401).send({ error: "join_key_required" });
      }

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        return await handleGetEntryRequestStatus({
          reply,
          repository,
          room,
          requestId,
          joinKey,
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to read entry request status");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/join/s/:shortCode/entry-requests/:requestId",
    { schema: { params: ShortCodeRequestIdParams } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository?.getJoinRoomByShortCode || !repository.getEntryRequestStatus) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { shortCode, requestId } = request.params as { shortCode: string; requestId: string };
      const joinKey = readJoinKeyHeader(request);
      if (!joinKey) {
        return reply.code(401).send({ error: "join_key_required" });
      }

      const normalizedShortCode = normalizeRoomShortCode(shortCode);
      try {
        const room = await repository.getJoinRoomByShortCode(normalizedShortCode);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        return await handleGetEntryRequestStatus({
          reply,
          repository,
          room,
          requestId,
          joinKey,
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to read entry request status by short code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};

async function handleRosterSearch(input: {
  reply: FastifyReply;
  repository: RoomRepository;
  room: StoredRoom;
  rawQuery?: string;
}) {
  const { reply, repository, room, rawQuery } = input;
  if (!canJoinRoom(room.status)) {
    return reply.code(409).send({ error: "room_not_joinable", status: room.status });
  }
  if (room.entryMode !== "aprovacao") {
    return reply.code(409).send({
      error: "approval_mode_required",
      message: "Esta sala não utiliza entrada por aprovação da mesa.",
    });
  }

  const normalizedQuery = normalizeRosterSearchQuery(rawQuery ?? "");
  if (normalizedQuery.length < 2) {
    return reply.code(400).send({
      error: "search_query_too_short",
      message: "Digite pelo menos 2 caracteres para buscar no rol.",
    });
  }

  const entries = await repository.searchRoomRoster!(room.id, normalizedQuery);
  return { entries };
}

async function handleSubmitEntryRequest(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  repository: RoomRepository;
  presencePublisher: PresencePublisher | undefined;
  room: StoredRoom;
  body: SubmitEntryRequestBodyType;
  failureScope: string;
}) {
  const { request, reply, repository, presencePublisher, room, body, failureScope } = input;

  if (!isValidJoinKey(body.joinKey)) {
    return reply.code(400).send({ error: "invalid_join_key" });
  }

  const result = await repository.submitEntryRequest!({
    roomId: room.id,
    rosterEntryId: body.rosterEntryId,
    joinKeyHash: hashJoinKey(body.joinKey),
    birthDay: body.birthDay,
    birthMonth: body.birthMonth,
  });

  if (!result.ok) {
    switch (result.reason) {
      case "room_not_found":
      case "roster_entry_not_found":
        return reply.code(404).send({ error: result.reason });
      case "room_not_joinable":
        return reply.code(409).send({ error: "room_not_joinable", status: room.status });
      case "approval_mode_required":
        return reply.code(409).send({
          error: "approval_mode_required",
          message: "Esta sala não utiliza entrada por aprovação da mesa.",
        });
      case "entry_closed":
        return reply.code(409).send({
          error: "entry_closed",
          message: "A entrada na sala foi encerrada pela mesa.",
        });
      case "room_capacity_reached":
        return reply.code(409).send({
          error: "room_capacity_reached",
          message: "O limite de participantes da sala foi atingido.",
        });
      case "voter_on_paper":
        return reply.code(409).send({
          error: "voter_on_paper",
          message: "Este eleitor está marcado para votar em papel. Procure a mesa.",
        });
      case "session_already_in_use":
        return reply.code(409).send({
          error: "session_already_in_use",
          message: "Este navegador já possui uma sessão ativa na sala.",
        });
      case "birth_date_required":
      case "invalid_birth_day_month":
        return reply.code(400).send({
          error: result.reason,
          message: "Informe o dia e o mês de nascimento.",
        });
      case "birth_date_mismatch":
        recordRateLimitHit(ENTRY_CONFIRM_RATE_LIMIT, failureScope);
        return reply.code(403).send({
          error: "birth_date_mismatch",
          message: "Dia ou mês de nascimento não conferem.",
        });
      case "roster_name_already_claimed":
        publishEntryRequestsUpdated(presencePublisher, request, room.id);
        return reply.code(409).send({
          error: "roster_name_already_claimed",
          message: "Este nome já foi reivindicado. A mesa foi avisada; procure a mesa.",
        });
    }
  }

  if (result.created) {
    publishEntryRequestsUpdated(presencePublisher, request, room.id);
  }

  return reply.code(result.created ? 201 : 200).send({
    status: result.status,
    requestId: result.requestId,
    displayName: result.displayName,
    shortCode: room.shortCode,
    ...(result.status === "approved" ? { inviteToken: room.inviteToken } : {}),
  });
}

async function handleGetEntryRequestStatus(input: {
  reply: FastifyReply;
  repository: RoomRepository;
  room: StoredRoom;
  requestId: string;
  joinKey: string;
}) {
  const { reply, repository, room, requestId, joinKey } = input;
  const result = await repository.getEntryRequestStatus!(
    room.id,
    requestId,
    hashJoinKey(joinKey),
  );
  if (!result.ok) {
    const statusCode = result.reason === "forbidden_entry_request" ? 403 : 404;
    return reply.code(statusCode).send({ error: result.reason });
  }

  return {
    requestId: result.requestId,
    status: result.status,
    displayName: result.displayName,
    title: room.title,
    roomStatus: room.status,
    shortCode: room.shortCode,
    ...(result.status === "approved" ? { inviteToken: room.inviteToken } : {}),
  };
}

async function completeRoomJoin(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  repository: RoomRepository;
  presencePublisher: PresencePublisher | undefined;
  room: StoredRoom;
  body: JoinBodyType;
  failureScope: string;
}): Promise<{ displayName: string; presentCount: number; alreadyJoined: boolean } | null> {
  const { request, reply, repository, presencePublisher, room, body, failureScope } = input;

  if (!canJoinRoom(room.status)) {
    await reply.code(409).send({ error: "room_not_joinable", status: room.status });
    return null;
  }

  const validated = validateAccessCodeJoin(body);
  if (!validated.ok) {
    await reply.code(400).send({ error: "invalid_join", details: validated.errors });
    return null;
  }

  const joinedResult = await repository.joinRoomWithCode(
    room.id,
    validated.value.code,
    hashJoinKey(validated.value.joinKey),
  );
  if (!joinedResult.ok) {
    if (joinedResult.reason === "approval_entry_required") {
      await reply.code(409).send({
        error: "approval_entry_required",
        message: "Esta sala utiliza entrada por aprovação da mesa.",
      });
      return null;
    }
    if (joinedResult.reason === "entry_closed") {
      await reply.code(409).send({
        error: "entry_closed",
        message: "A entrada na sala foi encerrada pela mesa.",
      });
      return null;
    }
    if (joinedResult.reason === "room_capacity_reached") {
      await reply.code(409).send({
        error: "room_capacity_reached",
        message: "O limite de participantes da sala foi atingido.",
      });
      return null;
    }
    if (joinedResult.reason === "access_code_in_use") {
      await reply.code(409).send({
        error: "access_code_in_use",
        message: "Este código já está em uso. Procure a mesa.",
      });
      return null;
    }

    recordRateLimitHit(JOIN_RATE_LIMIT, failureScope);
    // Revoked and unknown codes share one answer so codes cannot be told apart.
    await reply.code(403).send({
      error: "invalid_access_code",
      message: "Código de acesso inválido ou revogado.",
    });
    return null;
  }

  const joined = joinedResult.participant;
  const [presentCount, paperVotersCount] = await Promise.all([
    repository.countPresent(room.id),
    repository.countPaperVoters ? repository.countPaperVoters(room.id) : Promise.resolve(0),
  ]);
  publishPresence(
    presencePublisher,
    request,
    room.id,
    quorumStatus(room, presentCount, paperVotersCount),
  );

  return {
    displayName: joined.displayName,
    presentCount,
    alreadyJoined: joined.alreadyJoined,
  };
}

async function loadTotalPresentCount(repository: RoomRepository, roomId: string): Promise<number> {
  const [onlinePresentCount, paperVotersCount] = await Promise.all([
    repository.countPresent(roomId),
    repository.countPaperVoters ? repository.countPaperVoters(roomId) : Promise.resolve(0),
  ]);
  return onlinePresentCount + paperVotersCount;
}

function isValidJoinKey(joinKey: string): boolean {
  return (
    joinKey.length >= JOIN_KEY_MIN_LENGTH &&
    joinKey.length <= JOIN_KEY_MAX_LENGTH &&
    joinKey === joinKey.trim() &&
    JOIN_KEY_PATTERN.test(joinKey)
  );
}

function readJoinKeyHeader(request: FastifyRequest): string | null {
  const header = request.headers["x-scelta-join-key"];
  if (typeof header !== "string") {
    return null;
  }
  const trimmed = header.trim();
  return trimmed.length > 0 && trimmed.length <= JOIN_KEY_MAX_LENGTH ? trimmed : null;
}

function publishPresence(
  publisher: PresencePublisher | undefined,
  request: FastifyRequest,
  roomId: string,
  presence: PresenceSnapshot,
) {
  if (!publisher) {
    return;
  }

  try {
    publisher.publishPresence(roomId, presence);
  } catch (error) {
    request.log.error({ err: error, roomId }, "Failed to publish presence");
  }
}

function publishEntryRequestsUpdated(
  publisher: PresencePublisher | undefined,
  request: FastifyRequest,
  roomId: string,
) {
  if (!publisher?.publishEntryRequestsUpdated) {
    return;
  }

  try {
    publisher.publishEntryRequestsUpdated(roomId);
  } catch (error) {
    request.log.error({ err: error, roomId }, "Failed to publish entry requests update");
  }
}
