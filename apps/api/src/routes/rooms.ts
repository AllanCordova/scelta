import { createHash } from "node:crypto";
import {
  canSimulateInRoom,
  canTransitionRoomStatus,
  canUpdateRoomQuorum,
  countOfficeRoundNumber,
  findPreset,
  isMemberEligibleForRoomType,
  isMultiOfficeRoomType,
  isValidOfficeForRoomType,
  parsePhotoUrl,
  tallyRoundVotes,
  validateCandidateNames,
  validateCreateRoom,
  type RoundTally,
  type ValidRoomConfig,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/require-admin.js";
import type { PresencePublisher } from "../realtime.js";
import { loadRoomOfficeState } from "../rooms/office-state.js";
import { quorumStatus } from "../rooms/quorum-status.js";
import {
  toCandidatePhotoUrl,
  toOfficeBannerUrl,
  toPublicOfficeBanners,
} from "./media.js";
import type {
  RoomRepository,
  StoredCandidate,
  StoredRound,
  StoredRoom,
} from "../rooms/room-repository.js";
import { toRoundSummary } from "../rooms/round-summary.js";
import type { UserRepository } from "../users/user-repository.js";

const CreateRoomBody = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 200 }),
    roomType: Type.Union([
      Type.Literal("pastor"),
      Type.Literal("elder"),
      Type.Literal("deacon"),
      Type.Literal("session_board"),
      Type.Literal("upa_board"),
      Type.Literal("ump_board"),
      Type.Literal("custom"),
    ]),
    rulesPreset: Type.Union([
      Type.Literal("ipb_local_officers"),
      Type.Literal("ipb_society_board"),
      Type.Literal("custom"),
    ]),
    quorumValue: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
    quorumUnit: Type.Optional(Type.Union([Type.Literal("absolute"), Type.Literal("percent")])),
    eligibleCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
    status: Type.Optional(
      Type.Union([Type.Literal("draft"), Type.Literal("open"), Type.Literal("test")]),
    ),
    candidates: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 50 })),
  },
  { additionalProperties: false },
);

type CreateRoomBodyType = {
  title: string;
  roomType: string;
  rulesPreset: string;
  quorumValue?: number;
  quorumUnit?: string;
  eligibleCount?: number;
  status?: string;
  candidates?: string[];
};

const UpdateRoomBody = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    quorumValue: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    quorumUnit: Type.Optional(Type.Union([Type.Literal("absolute"), Type.Literal("percent")])),
    eligibleCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
    status: Type.Optional(
      Type.Union([
        Type.Literal("draft"),
        Type.Literal("open"),
        Type.Literal("test"),
        Type.Literal("closed"),
      ]),
    ),
    reactionsEnabled: Type.Optional(Type.Boolean()),
    chatMuted: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

type UpdateRoomBodyType = {
  title?: string;
  quorumValue?: number;
  quorumUnit?: "absolute" | "percent";
  eligibleCount?: number;
  status?: "draft" | "open" | "test" | "closed";
  reactionsEnabled?: boolean;
  chatMuted?: boolean;
};

const RoomIdParams = Type.Object({
  roomId: Type.String({
    minLength: 36,
    maxLength: 36,
    pattern:
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  }),
});

const RemoveParticipantsBody = Type.Object(
  {
    count: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
);

const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});

const IssueAccessCodeBody = Type.Object(
  {
    memberId: Uuid,
    replace: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const ExpelParticipantsBody = Type.Object(
  {
    all: Type.Optional(Type.Boolean()),
    participantId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

export type RoomRouteOptions = {
  roomRepository?: RoomRepository;
  userRepository?: UserRepository;
  presencePublisher?: PresencePublisher;
};

const CodeIdParams = Type.Object({
  roomId: Type.String({
    minLength: 36,
    maxLength: 36,
    pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  }),
  codeId: Type.String({
    minLength: 36,
    maxLength: 36,
    pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  }),
});

const SimulateCodesBody = Type.Object(
  {
    count: Type.Integer({ minimum: 1, maximum: 500 }),
  },
  { additionalProperties: false },
);

export const roomRoutes: FastifyPluginAsync<RoomRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post(
    "/v1/admin/rooms",
    {
      schema: {
        body: CreateRoomBody,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const body = request.body as CreateRoomBodyType;
      const validated = validateCreateRoom(body);
      if (!validated.ok) {
        return reply.code(400).send({ error: "invalid_room", details: validated.errors });
      }

      let candidateNames: string[] = [];
      try {
        const roll = await options.roomRepository.listMembers();
        if (body.candidates !== undefined && body.candidates.length > 0) {
          const validatedCandidates = validateCandidateNames(body.candidates);
          if (!validatedCandidates.ok) {
            return reply.code(400).send({
              error: "invalid_room",
              details: [{ field: "candidates", code: "invalid" }],
            });
          }
          candidateNames = validatedCandidates.value;

          if (roll.length > 0) {
            const memberByName = new Map(
              roll.map((member) => [member.fullName.toLocaleLowerCase(), member]),
            );
            for (const name of candidateNames) {
              const matched = memberByName.get(name.toLocaleLowerCase());
              if (
                matched &&
                !isMemberEligibleForRoomType(matched, { roomType: validated.value.roomType })
              ) {
                return reply.code(400).send({
                  error: "invalid_room",
                  details: [{ field: "candidates", code: "invalid" }],
                });
              }
            }
          }
        } else {
          const communicants = roll.filter((member) => member.isCommunicant);
          if (communicants.length === 0) {
            return reply.code(400).send({
              error: "invalid_room",
              details: [{ field: "candidates", code: "required" }],
            });
          }
          const validatedCommunicants = validateCandidateNames(
            communicants.map((member) => member.fullName),
          );
          if (!validatedCommunicants.ok || validatedCommunicants.value.length === 0) {
            return reply.code(400).send({
              error: "invalid_room",
              details: [{ field: "candidates", code: "required" }],
            });
          }
          candidateNames = validatedCommunicants.value;
        }

        const stored = await options.roomRepository.createRoom({
          title: validated.value.title,
          roomType: validated.value.roomType,
          rulesPreset: validated.value.rulesPreset,
          quorumValue: validated.value.quorumValue,
          quorumUnit: validated.value.quorumUnit,
          eligibleCount: validated.value.eligibleCount,
          status: validated.value.status,
          ...(candidateNames.length > 0 ? { candidates: candidateNames } : {}),
        });
        const storedCandidates =
          candidateNames.length > 0
            ? await options.roomRepository.listCandidates(stored.id)
            : [];

        return reply.code(201).send({
          room: {
            ...toRoomResponse(stored, {
              includeInvite: true,
              config: validated.value,
              candidates: storedCandidates,
            }),
            round: null,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to persist room");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get("/v1/admin/rooms", async (request, reply) => {
    if (!(await requireAdmin(request, reply, options.userRepository))) {
      return;
    }

    if (!options.roomRepository) {
      return reply.code(503).send({ error: "persistence_unavailable" });
    }

    try {
      const stored = await options.roomRepository.listRooms();
      const roomIds = stored.map((room) => room.id);
      const latest = await options.roomRepository.latestRounds(roomIds);
      const allCandidates = await options.roomRepository.listCandidatesByRooms(roomIds);
      const candidatesByRoom = groupCandidatesByRoom(allCandidates);
      const roundByRoom = new Map(latest.map((round) => [round.roomId, round]));
      const tallyByRound = await loadTalliesForClosedRounds(
        options.roomRepository,
        latest,
        candidatesByRoom,
      );

      return {
        rooms: stored.map((room) => {
          const round = roundByRoom.get(room.id) ?? null;
          const roomCandidates = candidatesByRoom.get(room.id) ?? [];
          return {
            ...toRoomResponse(room, { includeInvite: true, candidates: roomCandidates }),
            round: toRoundSummary(round, round ? (tallyByRound.get(round.id) ?? null) : null),
          };
        }),
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to list rooms");
      return reply.code(500).send({ error: "persistence_failed" });
    }
  });

  app.get(
    "/v1/admin/rooms/:roomId",
    {
      schema: {
        params: RoomIdParams,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const [roomCandidates, allCandidates, allRounds, presentCount, auditEvents] =
          await Promise.all([
            options.roomRepository.listCandidates(roomId),
            options.roomRepository.listAllCandidates(roomId),
            options.roomRepository.listRounds(roomId),
            options.roomRepository.countPresent(roomId),
            options.roomRepository.listAuditEvents(roomId),
          ]);
        const round = allRounds[allRounds.length - 1] ?? null;
        const officeRoundNumber = round ? countOfficeRoundNumber(allRounds, round) : undefined;
        const candidatesByRoom = new Map([
          [roomId, roomCandidates.length > 0 ? roomCandidates : allCandidates],
        ]);
        const allCandidatesByRoom = new Map([[roomId, allCandidates]]);
        const tallyByRound = await loadTalliesForClosedRounds(
          options.roomRepository,
          round ? [round] : [],
          candidatesByRoom,
          allCandidatesByRoom,
          round && officeRoundNumber !== undefined
            ? new Map([[round.id, officeRoundNumber]])
            : undefined,
        );
        const [receiptDates, officeState] = await Promise.all([
          round
            ? options.roomRepository.listRoundReceiptTimestamps(round.id)
            : Promise.resolve([]),
          loadRoomOfficeState(options.roomRepository, room, allCandidates, allRounds),
        ]);

        return {
          room: {
            ...toRoomResponse(room, { includeInvite: true, candidates: roomCandidates }),
            presence: quorumStatus(room, presentCount),
            votedCount: receiptDates.length,
            receiptTimestamps: receiptDates.map((date) => date.toISOString()),
            offices: officeState.offices.map((office) => {
              const winnerCandidate = office.winnerCandidateId
                ? allCandidates.find((candidate) => candidate.id === office.winnerCandidateId)
                : undefined;
              return {
                ...office,
                winnerPhotoUrl: winnerCandidate
                  ? toCandidatePhotoUrl(room.id, winnerCandidate.id, winnerCandidate.photoUrl)
                  : null,
                bannerUrl: toOfficeBannerUrl(
                  room.id,
                  office.officeLabel,
                  room.officeBanners?.[office.officeLabel],
                ),
              };
            }),
            recommendedOffice: officeState.recommendedOffice,
            auditEvents: auditEvents.map(toAuditEventResponse),
            round: toRoundSummary(
              round,
              round ? (tallyByRound.get(round.id) ?? null) : null,
              officeRoundNumber,
            ),
          },
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to read room detail");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/audit",
    {
      schema: {
        params: RoomIdParams,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const [events, verification] = await Promise.all([
          options.roomRepository.listAuditEvents(roomId),
          options.roomRepository.verifyAuditChain
            ? options.roomRepository.verifyAuditChain(roomId)
            : Promise.resolve({ chainValid: true, totalEvents: 0, chainTipHash: "GENESIS" }),
        ]);
        return {
          chainValid: verification.chainValid,
          chainTipHash: verification.chainTipHash,
          events: events.map((event) => ({
            roomId: event.roomId,
            ...toAuditEventResponse(event),
          })),
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to list audit events");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/audit/verify",
    {
      schema: {
        params: RoomIdParams,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const verification = options.roomRepository.verifyAuditChain
          ? await options.roomRepository.verifyAuditChain(roomId)
          : { chainValid: true, totalEvents: 0, chainTipHash: "GENESIS" };
        return verification;
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to verify audit chain");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/presence",
    {
      schema: {
        params: RoomIdParams,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const presentCount = await options.roomRepository.countPresent(roomId);
        return quorumStatus(room, presentCount);
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to read presence");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.patch(
    "/v1/admin/rooms/:roomId",
    {
      schema: {
        params: RoomIdParams,
        body: UpdateRoomBody,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as UpdateRoomBodyType;

      try {
        const existing = await options.roomRepository.findRoomById(roomId);
        if (!existing) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const nextTitle = body.title !== undefined ? body.title.trim() : existing.title;
        if (nextTitle.length === 0) {
          return reply.code(400).send({
            error: "invalid_room",
            details: [{ field: "title", code: "required" }],
          });
        }

        const nextQuorumUnit = body.quorumUnit ?? existing.quorumUnit;
        const nextQuorumValue = body.quorumValue ?? existing.quorumValue;
        if (
          nextQuorumValue < 1 ||
          (nextQuorumUnit === "percent" && nextQuorumValue > 100)
        ) {
          return reply.code(400).send({
            error: "invalid_room",
            details: [{ field: "quorumValue", code: "out_of_range" }],
          });
        }

        const roomRounds = await options.roomRepository.listRounds(roomId);
        const hasOpenRound = roomRounds.some((round) => round.status === "open");

        if (body.status !== undefined) {
          const transition = canTransitionRoomStatus(existing.status, body.status, {
            hasOpenRound,
          });
          if (!transition.ok) {
            return reply.code(409).send({
              error: transition.reason,
              message:
                transition.reason === "room_already_closed"
                  ? "Sala já encerrada não pode ser reaberta."
                  : "Não é possível alterar o status da sala com um escrutínio aberto.",
            });
          }
        }

        const isUpdatingQuorum =
          (body.quorumValue !== undefined && body.quorumValue !== existing.quorumValue) ||
          (body.quorumUnit !== undefined && body.quorumUnit !== existing.quorumUnit) ||
          (body.eligibleCount !== undefined && body.eligibleCount !== existing.eligibleCount);

        if (isUpdatingQuorum) {
          const quorumCheck = canUpdateRoomQuorum({
            roomStatus: existing.status,
            hasOpenRound,
          });
          if (!quorumCheck.ok) {
            return reply.code(409).send({
              error: quorumCheck.reason,
              message:
                quorumCheck.reason === "room_closed"
                  ? "Não é possível alterar o quórum de uma sala encerrada."
                  : "Não é possível alterar o quórum ou o total de eleitores com um escrutínio aberto.",
            });
          }
        }

        if (
          body.status === "open" &&
          existing.status === "test" &&
          (await options.roomRepository.hasSimulatedAccessCodes?.(roomId))
        ) {
          return reply.code(409).send({ error: "cannot_open_test_room" });
        }

        const updated = await options.roomRepository.updateRoom(roomId, {
          title: body.title !== undefined ? nextTitle : undefined,
          quorumValue: body.quorumValue,
          quorumUnit: body.quorumUnit,
          eligibleCount: body.eligibleCount,
          status: body.status,
          reactionsEnabled: body.reactionsEnabled,
          chatMuted: body.chatMuted,
        });
        if (!updated) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const [candidates, presentCount] = await Promise.all([
          options.roomRepository.listCandidates(roomId),
          options.roomRepository.countPresent(roomId),
        ]);
        options.presencePublisher?.publishPresence(roomId, quorumStatus(updated, presentCount));
        if (body.reactionsEnabled !== undefined) {
          options.presencePublisher?.publishReactionsConfig?.(roomId, updated.reactionsEnabled);
        }
        if (body.chatMuted !== undefined) {
          options.presencePublisher?.publishChatConfig?.(roomId, {
            chatMuted: updated.chatMuted ?? false,
          });
        }

        return { room: toRoomResponse(updated, { includeInvite: true, candidates }) };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to update room");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.put(
    "/v1/admin/rooms/:roomId/office-banner",
    {
      schema: {
        params: RoomIdParams,
        body: Type.Object(
          {
            officeLabel: Type.Optional(
              Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]),
            ),
            bannerUrl: Type.Union([Type.String({ maxLength: 12_000_000 }), Type.Null()]),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as {
        officeLabel?: string | null;
        bannerUrl: string | null;
      };

      const parsedBanner = parsePhotoUrl(body.bannerUrl);
      if (!parsedBanner.ok) {
        return reply.code(400).send({ error: "invalid_banner_url" });
      }

      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        let officeKey = "default";
        if (isMultiOfficeRoomType(room.roomType)) {
          if (!body.officeLabel || !isValidOfficeForRoomType(room.roomType, body.officeLabel)) {
            return reply.code(400).send({ error: "invalid_office" });
          }
          officeKey = body.officeLabel;
        } else if (body.officeLabel !== undefined && body.officeLabel !== null) {
          return reply.code(400).send({ error: "invalid_office" });
        }

        const updated = await options.roomRepository.setOfficeBanner(
          roomId,
          officeKey,
          parsedBanner.value,
        );
        if (!updated) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        return {
          room: toRoomResponse(updated, { includeInvite: true }),
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to update office banner");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/invite/rotate",
    {
      schema: {
        params: RoomIdParams,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const updated = await options.roomRepository.rotateInviteToken(roomId);
        if (!updated) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const candidates = await options.roomRepository.listCandidates(roomId);
        return { room: toRoomResponse(updated, { includeInvite: true, candidates }) };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to rotate invite token");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.delete(
    "/v1/admin/rooms/:roomId",
    {
      schema: {
        params: RoomIdParams,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const deleted = await options.roomRepository.deleteRoom(roomId);
        if (!deleted) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        return reply.code(204).send();
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to delete room");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/participants/remove",
    {
      schema: {
        params: RoomIdParams,
        body: RemoveParticipantsBody,
      },
    },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const { count } = request.body as { count: number };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        if (!canSimulateInRoom(room.status)) {
          return reply.code(409).send({ error: "simulation_requires_test_room" });
        }

        const removedCount = await options.roomRepository.removePresentParticipants(roomId, count);
        const presentCount = await options.roomRepository.countPresent(roomId);
        const presence = quorumStatus(room, presentCount);
        options.presencePublisher?.publishPresence(roomId, presence);

        return { removedCount, presence };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to remove participants");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/participants",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.listParticipants) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const rows = await options.roomRepository.listParticipants(roomId);
        return {
          participants: rows
            .filter((participant) => participant.isPresent)
            .map((participant) => ({
              id: participant.id,
              displayName: participant.displayName,
              joinedAt: participant.joinedAt.toISOString(),
            })),
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to list present participants");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/participants/expel",
    { schema: { params: RoomIdParams, body: ExpelParticipantsBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.expelParticipants) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as { all?: boolean; participantId?: string };
      const expelAll = body.all === true;
      if (expelAll === Boolean(body.participantId)) {
        return reply.code(400).send({ error: "invalid_expel" });
      }

      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const expelledCount = await options.roomRepository.expelParticipants(
          roomId,
          expelAll ? undefined : body.participantId,
        );
        const presentCount = await options.roomRepository.countPresent(roomId);
        const presence = quorumStatus(room, presentCount);
        options.presencePublisher?.publishPresence(roomId, presence);
        return { expelledCount, presence };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to expel participants");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/access-codes",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const codes = await options.roomRepository.listAccessCodes(roomId);
        return { accessCodes: codes.map(toAccessCodeResponse) };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to list access codes");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/access-codes/generate",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const codes = await options.roomRepository.generateMemberAccessCodes(roomId);
        return { accessCodes: codes.map(toAccessCodeResponse) };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to generate access codes");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/access-codes/issue",
    { schema: { params: RoomIdParams, body: IssueAccessCodeBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.issueMemberAccessCode) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as { memberId: string; replace?: boolean };
      try {
        const issued = await options.roomRepository.issueMemberAccessCode(
          roomId,
          body.memberId,
          body.replace === true,
        );
        if (!issued.ok) {
          const status = issued.reason === "member_ineligible" ? 422 : 404;
          return reply.code(status).send({ error: issued.reason });
        }
        return {
          accessCode: toAccessCodeResponse(issued.accessCode),
          created: issued.created,
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to issue access code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/access-codes/simulate",
    { schema: { params: RoomIdParams, body: SimulateCodesBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const { count } = request.body as { count: number };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        if (!canSimulateInRoom(room.status)) {
          return reply.code(409).send({ error: "simulation_requires_test_room" });
        }
        const codes = await options.roomRepository.createSimulatedAccessCodes(roomId, count);
        return { accessCodes: codes.map(toAccessCodeResponse) };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to create simulated access codes");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/access-codes/:codeId/revoke",
    { schema: { params: CodeIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, codeId } = request.params as { roomId: string; codeId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const revoked = await options.roomRepository.revokeAccessCode(roomId, codeId);
        if (!revoked) {
          return reply.code(404).send({ error: "access_code_not_found" });
        }
        const presentCount = await options.roomRepository.countPresent(roomId);
        const presence = quorumStatus(room, presentCount);
        options.presencePublisher?.publishPresence(roomId, presence);
        return { accessCode: toAccessCodeResponse(revoked), presence };
      } catch (error) {
        request.log.error({ err: error, roomId, codeId }, "Failed to revoke access code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/access-codes/revoke-all",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const revokedCount = await options.roomRepository.revokeAllAccessCodes(roomId);
        const presentCount = await options.roomRepository.countPresent(roomId);
        const presence = quorumStatus(room, presentCount);
        options.presencePublisher?.publishPresence(roomId, presence);
        return { revokedCount, presence };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to revoke all access codes");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.delete(
    "/v1/admin/rooms/:roomId/access-codes/:codeId",
    { schema: { params: CodeIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, codeId } = request.params as { roomId: string; codeId: string };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        const deleted = await options.roomRepository.deleteAccessCode(roomId, codeId);
        if (!deleted) {
          return reply.code(404).send({ error: "access_code_not_found" });
        }
        const presentCount = await options.roomRepository.countPresent(roomId);
        const presence = quorumStatus(room, presentCount);
        options.presencePublisher?.publishPresence(roomId, presence);
        return { deleted: true, presence };
      } catch (error) {
        request.log.error({ err: error, roomId, codeId }, "Failed to delete access code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get("/v1/admin/logs", async (request, reply) => {
    if (!(await requireAdmin(request, reply, options.userRepository))) {
      return;
    }
    if (!options.roomRepository) {
      return reply.code(503).send({ error: "persistence_unavailable" });
    }

    const query = (request.query ?? {}) as { roomId?: string };
    const roomIdFilter =
      typeof query.roomId === "string" && query.roomId.trim().length > 0
        ? query.roomId.trim()
        : undefined;
    if (
      roomIdFilter &&
      !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        roomIdFilter,
      )
    ) {
      return reply.code(400).send({ error: "invalid_room_id" });
    }

    try {
      const [events, allRooms, verification] = await Promise.all([
        options.roomRepository.listAllAuditEvents
          ? options.roomRepository.listAllAuditEvents(roomIdFilter)
          : roomIdFilter
            ? options.roomRepository.listAuditEvents(roomIdFilter)
            : Promise.resolve([]),
        options.roomRepository.listRooms(),
        options.roomRepository.verifyAuditChain
          ? options.roomRepository.verifyAuditChain(roomIdFilter)
          : Promise.resolve({ chainValid: true, totalEvents: 0, chainTipHash: "GENESIS" }),
      ]);

      const roomMap = new Map(allRooms.map((r) => [r.id, r]));
      const distinctRooms = new Map<
        string,
        { id: string; title: string; status: string; deleted: boolean }
      >();
      for (const r of allRooms) {
        distinctRooms.set(r.id, {
          id: r.id,
          title: r.title,
          status: r.status,
          deleted: false,
        });
      }

      let previousHash = "GENESIS";
      const logsWithHashes = events.map((event, index) => {
        const knownRoom = roomMap.get(event.roomId);
        const titleFromPayload =
          typeof event.payload?.title === "string" ? event.payload.title : null;
        const roomTitle =
          event.roomTitle ?? knownRoom?.title ?? titleFromPayload ?? `Sala ${event.roomId.slice(0, 8)}`;
        const roomStatus =
          event.roomStatus ??
          knownRoom?.status ??
          (typeof event.payload?.roomStatus === "string"
            ? event.payload.roomStatus
            : typeof event.payload?.status === "string"
              ? event.payload.status
              : "closed");
        if (!distinctRooms.has(event.roomId)) {
          distinctRooms.set(event.roomId, {
            id: event.roomId,
            title: roomTitle,
            status: String(roomStatus),
            deleted: true,
          });
        }

        const iso = event.createdAt.toISOString();
        const integrityHash =
          event.integrityHash ??
          createHash("sha256")
            .update(`${previousHash}:${event.id}:${event.roomId}:${event.actorRole}:${event.action}:${iso}`)
            .digest("hex")
            .slice(0, 16)
            .toUpperCase();
        previousHash = integrityHash;

        return {
          id: event.id,
          sequence: index + 1,
          roomId: event.roomId,
          roomTitle,
          roomStatus: String(roomStatus),
          actorRole: event.actorRole,
          action: event.action,
          payload: event.payload,
          createdAt: iso,
          ...(event.prevHash ? { prevHash: event.prevHash } : {}),
          integrityHash,
        };
      });

      const humanBallotsCast = logsWithHashes.filter(
        (item) => item.action === "ballot_cast" && item.actorRole === "voter",
      ).length;
      const simulatedBallotsCast = logsWithHashes.filter(
        (item) => item.action === "ballot_cast" && item.actorRole === "simulated_voter",
      ).length;
      const humanParticipantsJoined = logsWithHashes.filter(
        (item) => item.action === "participant_joined" && item.actorRole === "voter",
      ).length;
      const simulatedParticipantsJoined = logsWithHashes.filter(
        (item) => item.action === "participant_joined" && item.actorRole === "simulated_voter",
      ).length;

      return {
        summary: {
          totalEvents: logsWithHashes.length,
          humanBallotsCast,
          simulatedBallotsCast,
          humanParticipantsJoined,
          simulatedParticipantsJoined,
          adminVoteInterventions: 0,
          immutable: true,
          chainValid: verification.chainValid,
          chainTipHash: previousHash,
        },
        rooms: Array.from(distinctRooms.values()),
        logs: logsWithHashes,
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to list integrity logs");
      return reply.code(500).send({ error: "persistence_failed" });
    }
  });

  app.delete("/v1/admin/logs", async (request, reply) => {
    if (!(await requireAdmin(request, reply, options.userRepository))) {
      return;
    }
    return reply.code(403).send({
      error: "logs_are_immutable",
      message: "Os logs de auditoria e comprovação de votos são permanentes e inapagáveis, inclusive para administradores.",
    });
  });

  app.delete("/v1/admin/logs/:logId", async (request, reply) => {
    if (!(await requireAdmin(request, reply, options.userRepository))) {
      return;
    }
    return reply.code(403).send({
      error: "logs_are_immutable",
      message: "Os logs de auditoria e comprovação de votos são permanentes e inapagáveis, inclusive para administradores.",
    });
  });

  app.patch("/v1/admin/logs/:logId", async (request, reply) => {
    if (!(await requireAdmin(request, reply, options.userRepository))) {
      return;
    }
    return reply.code(403).send({
      error: "logs_are_immutable",
      message: "Os logs de auditoria e comprovação de votos são permanentes e inalteráveis.",
    });
  });
};

function toAccessCodeResponse(row: {
  id: string;
  memberId: string | null;
  displayName: string;
  code: string;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    memberId: row.memberId,
    displayName: row.displayName,
    code: row.code,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRoomResponse(
  room: StoredRoom,
  options: {
    includeInvite: boolean;
    config?: ValidRoomConfig;
    candidates?: StoredCandidate[];
  },
) {
  const preset = options.config ?? findPreset(room.rulesPreset);
  const candidates = options.candidates ?? [];

  return {
    id: room.id,
    title: room.title,
    roomType: room.roomType,
    rulesPreset: room.rulesPreset,
    quorumValue: room.quorumValue,
    quorumUnit: room.quorumUnit,
    eligibleCount: room.eligibleCount,
    officeBanners: toPublicOfficeBanners(room.id, room.officeBanners),
    status: room.status,
    reactionsEnabled: room.reactionsEnabled,
    chatMuted: room.chatMuted ?? false,
    ...(candidates.length > 0
      ? {
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            displayName: candidate.displayName,
            photoUrl: toCandidatePhotoUrl(room.id, candidate.id, candidate.photoUrl),
          })),
        }
      : {}),
    ...(options.includeInvite
      ? {
          inviteToken: room.inviteToken,
          invitePath: `/join/${room.inviteToken}`,
        }
      : {}),
    majorityRule: preset.majorityRule,
    roundBehavior: preset.roundBehavior,
    createdAt: room.createdAt.toISOString(),
  };
}

function groupCandidatesByRoom(candidates: StoredCandidate[]): Map<string, StoredCandidate[]> {
  const grouped = new Map<string, StoredCandidate[]>();
  for (const candidate of candidates) {
    const existing = grouped.get(candidate.roomId) ?? [];
    existing.push(candidate);
    grouped.set(candidate.roomId, existing);
  }
  return grouped;
}

async function loadTalliesForClosedRounds(
  repository: RoomRepository,
  rounds: StoredRound[],
  candidatesByRoom: Map<string, StoredCandidate[]>,
  fallbackCandidatesByRoom?: Map<string, StoredCandidate[]>,
  officeRoundNumberByRoundId?: Map<string, number>,
): Promise<Map<string, RoundTally>> {
  const tallies = new Map<string, RoundTally>();
  for (const round of rounds) {
    if (round.status !== "closed") {
      continue;
    }
    if (round.outcome !== "elected" && round.outcome !== "no_majority") {
      continue;
    }
    const primaryCandidates = candidatesByRoom.get(round.roomId) ?? [];
    const fallbackCandidates = fallbackCandidatesByRoom?.get(round.roomId) ?? primaryCandidates;
    if (primaryCandidates.length === 0 && fallbackCandidates.length === 0) {
      continue;
    }
    const ballotCandidateIds = await repository.listRoundBallotCandidateIds(round.id);
    const primaryIds = new Set(primaryCandidates.map((candidate) => candidate.id));
    const usePrimary =
      primaryCandidates.length > 0 &&
      ballotCandidateIds.every((id) => id === null || primaryIds.has(id));
    const pool = usePrimary ? primaryCandidates : fallbackCandidates;
    const roundNumber = officeRoundNumberByRoundId?.get(round.id) ?? round.number;
    tallies.set(
      round.id,
      tallyRoundVotes(pool, ballotCandidateIds, {
        roundNumber,
        winnerOverrideId: round.winnerCandidateId,
        tieBreakReason: round.tieBreakReason,
        ...(round.didNotVoteCount !== undefined && round.didNotVoteCount > 0
          ? { didNotVoteCount: round.didNotVoteCount }
          : {}),
      }),
    );
  }
  return tallies;
}

function toAuditEventResponse(event: {
  id: string;
  actorRole: string;
  action: string;
  payload: Record<string, unknown>;
  prevHash?: string | null;
  integrityHash?: string;
  createdAt: Date;
}) {
  return {
    id: event.id,
    actorRole: event.actorRole,
    action: event.action,
    payload: event.payload,
    ...(event.prevHash ? { prevHash: event.prevHash } : {}),
    ...(event.integrityHash ? { integrityHash: event.integrityHash } : {}),
    createdAt: event.createdAt.toISOString(),
  };
}
