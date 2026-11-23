import { createHash } from "node:crypto";
import {
  canConfigureRoomVacancies,
  canSimulateInRoom,
  canTransitionRoomStatus,
  canUpdateRoomQuorum,
  countOfficeRoundNumber,
  evaluateMultiVacancyProgress,
  findPreset,
  isMemberEligibleForRoomType,
  isMemberEligibleVoter,
  isMultiOfficeRoomType,
  isValidOfficeForRoomType,
  MAX_ROOM_VACANCIES,
  parseIsoDate,
  parsePhotoUrl,
  resolveRoomMaxParticipants,
  tallyRoundVotes,
  validateCandidateNames,
  validateCreateRoom,
  type BallotChoiceInput,
  type RoomEntryMode,
  type RoundTally,
  type ValidRoomConfig,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/require-admin.js";
import type { PresencePublisher } from "../realtime.js";
import { loadRoomOfficeState } from "../rooms/office-state.js";
import { loadRoomPresence, quorumStatus } from "../rooms/quorum-status.js";
import {
  toCandidatePhotoUrl,
  toOfficeBannerUrl,
  toPublicOfficeBanners,
} from "./media.js";
import type {
  RoomRepository,
  StoredCandidate,
  StoredEntryRequest,
  StoredPaperTally,
  StoredRound,
  StoredRoom,
} from "../rooms/room-repository.js";
import { toRoundSummary, type LiveRoundTally } from "../rooms/round-summary.js";
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
    vacancies: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_ROOM_VACANCIES })),
    entryMode: Type.Optional(Type.Union([Type.Literal("codigo"), Type.Literal("aprovacao")])),
    entryOpen: Type.Optional(Type.Boolean()),
    maxParticipants: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100_000 }), Type.Null()]),
    ),
    showLiveCandidateTally: Type.Optional(Type.Boolean()),
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
  vacancies?: number;
  entryMode?: RoomEntryMode;
  entryOpen?: boolean;
  maxParticipants?: number | null;
  showLiveCandidateTally?: boolean;
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
    vacancies: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_ROOM_VACANCIES })),
    entryMode: Type.Optional(Type.Union([Type.Literal("codigo"), Type.Literal("aprovacao")])),
    entryOpen: Type.Optional(Type.Boolean()),
    maxParticipants: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100_000 }), Type.Null()]),
    ),
    showLiveCandidateTally: Type.Optional(Type.Boolean()),
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
  vacancies?: number;
  entryMode?: RoomEntryMode;
  entryOpen?: boolean;
  maxParticipants?: number | null;
  showLiveCandidateTally?: boolean;
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

const ParticipantIdParams = Type.Object({
  roomId: Uuid,
  participantId: Uuid,
});

const RosterEntryIdParams = Type.Object({
  roomId: Uuid,
  entryId: Uuid,
});

const CandidateIdParams = Type.Object({
  roomId: Uuid,
  candidateId: Uuid,
});

const EntryRequestIdParams = Type.Object({
  roomId: Uuid,
  requestId: Uuid,
});

const ReleaseClaimedNameBody = Type.Object(
  {
    rosterEntryId: Type.Optional(Uuid),
    participantId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

const AddRosterEntryBody = Type.Object(
  {
    memberId: Type.Optional(Uuid),
    fullName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    birthDate: Type.Optional(Type.Union([Type.String({ minLength: 10, maxLength: 10 }), Type.Null()])),
    isCommunicant: Type.Optional(Type.Boolean()),
    isMale: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
  },
  { additionalProperties: false },
);

const SetPaperModeBody = Type.Object(
  {
    votesOnPaper: Type.Boolean(),
  },
  { additionalProperties: false },
);

const AddRoomCandidateBody = Type.Object(
  {
    memberId: Type.Optional(Uuid),
    rosterEntryId: Type.Optional(Uuid),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    birthDate: Type.Optional(Type.Union([Type.String({ minLength: 10, maxLength: 10 }), Type.Null()])),
    officeLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);

const DeleteRoomCandidateQuery = Type.Object(
  {
    officeLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);

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
          const eligibleCandidates = roll.filter((member) =>
            isMemberEligibleForRoomType(member, { roomType: validated.value.roomType }),
          );
          const fallbackPool =
            eligibleCandidates.length > 0
              ? eligibleCandidates
              : roll.filter((member) => isMemberEligibleVoter(member, validated.value.roomType));
          if (fallbackPool.length === 0) {
            return reply.code(400).send({
              error: "invalid_room",
              details: [{ field: "candidates", code: "required" }],
            });
          }
          const validatedDefaultCandidates = validateCandidateNames(
            fallbackPool.map((member) => member.fullName),
          );
          if (!validatedDefaultCandidates.ok || validatedDefaultCandidates.value.length === 0) {
            return reply.code(400).send({
              error: "invalid_room",
              details: [{ field: "candidates", code: "required" }],
            });
          }
          candidateNames = validatedDefaultCandidates.value;
        }

        const stored = await options.roomRepository.createRoom({
          title: validated.value.title,
          roomType: validated.value.roomType,
          rulesPreset: validated.value.rulesPreset,
          quorumValue: validated.value.quorumValue,
          quorumUnit: validated.value.quorumUnit,
          eligibleCount: validated.value.eligibleCount,
          status: validated.value.status,
          vacancies: validated.value.vacancies,
          entryMode: validated.value.entryMode,
          entryOpen: validated.value.entryOpen,
          maxParticipants: validated.value.maxParticipants,
          showLiveCandidateTally: body.showLiveCandidateTally ?? false,
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

        const [roomCandidates, allCandidates, allRounds, presence, auditEvents] =
          await Promise.all([
            options.roomRepository.listCandidates(roomId),
            options.roomRepository.listAllCandidates(roomId),
            options.roomRepository.listRounds(roomId),
            loadRoomPresence(options.roomRepository, room),
            options.roomRepository.listAuditEvents(roomId),
          ]);
        const round = allRounds[allRounds.length - 1] ?? null;
        const officeRoundNumber = round ? countOfficeRoundNumber(allRounds, round) : undefined;
        const candidatesByRoom = new Map([
          [roomId, roomCandidates.length > 0 ? roomCandidates : allCandidates],
        ]);
        const allCandidatesByRoom = new Map([[roomId, allCandidates]]);
        const [tallyByRound, roundPaperTally, receiptDates, officeState, openRoundBallotChoices] =
          await Promise.all([
            loadTalliesForClosedRounds(
              options.roomRepository,
              round ? [round] : [],
              candidatesByRoom,
              allCandidatesByRoom,
              round && officeRoundNumber !== undefined
                ? new Map([[round.id, officeRoundNumber]])
                : undefined,
            ),
            round && options.roomRepository.findRoundPaperTally
              ? options.roomRepository.findRoundPaperTally(round.id)
              : Promise.resolve(null),
            round
              ? options.roomRepository.listRoundReceiptTimestamps(round.id)
              : Promise.resolve([]),
            loadRoomOfficeState(options.roomRepository, room, allCandidates, allRounds),
            round && round.status === "open"
              ? options.roomRepository.listRoundBallotMarks
                ? options.roomRepository.listRoundBallotMarks(round.id)
                : options.roomRepository.listRoundBallotCandidateIds(round.id)
              : Promise.resolve(null),
          ]);

        const liveTally =
          round && round.status === "open" && openRoundBallotChoices !== null
            ? buildLiveRoundTally({
                candidates: roomCandidates.length > 0 ? roomCandidates : allCandidates,
                ballotChoices: openRoundBallotChoices,
                paperTally: roundPaperTally,
                vacancies: round.vacancies ?? 1,
                includeStandings: room.showLiveCandidateTally ?? false,
              })
            : null;

        const vacancyProgress = evaluateMultiVacancyProgress(room.vacancies ?? 1, allRounds);
        const electedCandidates = vacancyProgress.electedCandidateIds
          .map((id) => allCandidates.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is StoredCandidate => Boolean(candidate))
          .map((candidate) => ({
            id: candidate.id,
            displayName: candidate.displayName,
            photoUrl: toCandidatePhotoUrl(room.id, candidate.id, candidate.photoUrl),
          }));

        return {
          room: {
            ...toRoomResponse(room, {
              includeInvite: true,
              candidates: roomCandidates,
              includeCandidateDetails: true,
            }),
            hasRounds: allRounds.length > 0,
            remainingVacancies: vacancyProgress.remainingVacancies,
            electedCandidates,
            lockedOffices: Array.from(
              new Set(
                allRounds
                  .map((item) => item.officeLabel)
                  .filter((label): label is string => label !== null),
              ),
            ),
            presence,
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
              roundPaperTally,
              liveTally,
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

        return loadRoomPresence(options.roomRepository, room);
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

        if (body.vacancies !== undefined && body.vacancies !== existing.vacancies) {
          if (existing.status === "closed") {
            return reply.code(409).send({
              error: "room_closed",
              message: "Não é possível alterar o número de vagas de uma sala encerrada.",
            });
          }
          if (!canConfigureRoomVacancies(existing.roomType) && body.vacancies > 1) {
            return reply.code(400).send({
              error: "invalid_room",
              details: [{ field: "vacancies", code: "invalid" }],
            });
          }
          if (roomRounds.length > 0) {
            return reply.code(409).send({
              error: "vacancies_locked_after_round",
              message: "Não é possível alterar o número de vagas após a abertura do 1º escrutínio.",
            });
          }
        }

        const isUpdatingEntryConfig =
          (body.entryMode !== undefined && body.entryMode !== existing.entryMode) ||
          (body.entryOpen !== undefined && body.entryOpen !== existing.entryOpen) ||
          (body.maxParticipants !== undefined && body.maxParticipants !== existing.maxParticipants) ||
          (body.showLiveCandidateTally !== undefined &&
            body.showLiveCandidateTally !== existing.showLiveCandidateTally);

        if (isUpdatingEntryConfig && existing.status === "closed") {
          return reply.code(409).send({
            error: "room_closed",
            message: "Não é possível alterar as configurações de entrada de uma sala encerrada.",
          });
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
          vacancies: body.vacancies,
          entryMode: body.entryMode,
          entryOpen: body.entryOpen,
          maxParticipants: body.maxParticipants,
          showLiveCandidateTally: body.showLiveCandidateTally,
          reactionsEnabled: body.reactionsEnabled,
          chatMuted: body.chatMuted,
        });
        if (!updated) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const [candidates, presence] = await Promise.all([
          options.roomRepository.listCandidates(roomId),
          loadRoomPresence(options.roomRepository, updated),
        ]);
        options.presencePublisher?.publishPresence(roomId, presence);
        if (body.reactionsEnabled !== undefined) {
          options.presencePublisher?.publishReactionsConfig?.(roomId, updated.reactionsEnabled);
        }
        if (body.chatMuted !== undefined) {
          options.presencePublisher?.publishChatConfig?.(roomId, {
            chatMuted: updated.chatMuted ?? false,
          });
        }
        if (body.showLiveCandidateTally !== undefined || body.entryOpen !== undefined) {
          options.presencePublisher?.publishTelaoUpdated?.(roomId);
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
        const presence = await loadRoomPresence(options.roomRepository, room);
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
        const presence = await loadRoomPresence(options.roomRepository, room);
        options.presencePublisher?.publishPresence(roomId, presence);
        options.presencePublisher?.publishEntryRequestsUpdated?.(roomId);
        return { expelledCount, presence };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to expel participants");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/participants/:participantId/release-session",
    { schema: { params: ParticipantIdParams } },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin) {
        return;
      }
      if (!options.roomRepository?.releaseParticipantSession) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, participantId } = request.params as {
        roomId: string;
        participantId: string;
      };
      try {
        const room = await options.roomRepository.findRoomById(roomId);
        if (!room) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        const released = await options.roomRepository.releaseParticipantSession(
          roomId,
          participantId,
          admin.id,
        );
        if (!released.ok) {
          return reply.code(404).send({ error: released.reason });
        }

        const presence = await loadRoomPresence(options.roomRepository, room);
        options.presencePublisher?.publishPresence(roomId, presence);
        options.presencePublisher?.publishEntryRequestsUpdated?.(roomId);

        return {
          released: true,
          participant: released.participant,
          presence,
        };
      } catch (error) {
        request.log.error({ err: error, roomId, participantId }, "Failed to release participant session");
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
        const presence = await loadRoomPresence(options.roomRepository, room);
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
        const presence = await loadRoomPresence(options.roomRepository, room);
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
        const presence = await loadRoomPresence(options.roomRepository, room);
        options.presencePublisher?.publishPresence(roomId, presence);
        return { deleted: true, presence };
      } catch (error) {
        request.log.error({ err: error, roomId, codeId }, "Failed to delete access code");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/roster",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.listRoomRoster) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const result = await options.roomRepository.listRoomRoster(roomId);
        if (!result) {
          return reply.code(404).send({ error: "room_not_found" });
        }
        return {
          entries: result.entries.map(toRosterEntryResponse),
          eligibleCount: result.eligibleCount,
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to list room roster");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/roster",
    { schema: { params: RoomIdParams, body: AddRosterEntryBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.addRosterEntry) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as {
        memberId?: string;
        fullName?: string;
        birthDate?: string | null;
        isCommunicant?: boolean;
        isMale?: boolean | null;
      };

      let input:
        | { memberId: string }
        | {
            fullName: string;
            birthDate?: string | null;
            isCommunicant?: boolean;
            isMale?: boolean | null;
          };

      if (body.memberId !== undefined) {
        input = { memberId: body.memberId };
      } else {
        const fullName = body.fullName?.trim() ?? "";
        if (fullName.length < 2) {
          return reply.code(400).send({ error: "invalid_roster_entry" });
        }
        if (body.birthDate !== undefined && body.birthDate !== null && !parseIsoDate(body.birthDate)) {
          return reply.code(400).send({ error: "invalid_birth_date" });
        }
        input = {
          fullName,
          ...(body.birthDate !== undefined ? { birthDate: body.birthDate } : {}),
          ...(body.isCommunicant !== undefined ? { isCommunicant: body.isCommunicant } : {}),
          ...(body.isMale !== undefined ? { isMale: body.isMale } : {}),
        };
      }

      try {
        const result = await options.roomRepository.addRosterEntry(roomId, input);
        if (!result.ok) {
          if (result.reason === "room_not_found" || result.reason === "member_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          return reply.code(409).send({
            error: result.reason,
            message:
              result.reason === "room_closed"
                ? "Não é possível alterar o rol de uma sala encerrada."
                : "Este membro já está no rol da sala.",
          });
        }

        const room = await options.roomRepository.findRoomById(roomId);
        if (room) {
          const presence = await loadRoomPresence(options.roomRepository, room);
          options.presencePublisher?.publishPresence(roomId, presence);
        }

        return reply.code(201).send({
          entry: toRosterEntryResponse(result.entry),
          accessCode: toAccessCodeResponse(result.accessCode),
          eligibleCount: result.eligibleCount,
        });
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to add roster entry");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.delete(
    "/v1/admin/rooms/:roomId/roster/:entryId",
    { schema: { params: RosterEntryIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.removeRosterEntry) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, entryId } = request.params as { roomId: string; entryId: string };
      try {
        const result = await options.roomRepository.removeRosterEntry(roomId, entryId);
        if (!result.ok) {
          if (result.reason === "room_not_found" || result.reason === "roster_entry_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          return reply.code(409).send({
            error: result.reason,
            message: "Não é possível alterar o rol de uma sala encerrada.",
          });
        }

        const room = await options.roomRepository.findRoomById(roomId);
        const presence = room
          ? await loadRoomPresence(options.roomRepository, room)
          : {
              presentCount: await options.roomRepository.countPresent(roomId),
              eligibleCount: result.eligibleCount,
              requiredCount: 0,
              quorumMet: false,
            };
        options.presencePublisher?.publishPresence(roomId, presence);

        return {
          removed: true,
          eligibleCount: result.eligibleCount,
          presence,
        };
      } catch (error) {
        request.log.error({ err: error, roomId, entryId }, "Failed to remove roster entry");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.patch(
    "/v1/admin/rooms/:roomId/roster/:entryId/paper-mode",
    { schema: { params: RosterEntryIdParams, body: SetPaperModeBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.setRosterEntryPaperMode) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, entryId } = request.params as { roomId: string; entryId: string };
      const body = request.body as { votesOnPaper: boolean };
      try {
        const result = await options.roomRepository.setRosterEntryPaperMode(
          roomId,
          entryId,
          body.votesOnPaper,
        );
        if (!result.ok) {
          if (result.reason === "room_not_found" || result.reason === "roster_entry_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          if (result.reason === "already_voted_online") {
            return reply.code(409).send({
              error: "already_voted_online",
              message: "Este eleitor já votou online no escrutínio aberto.",
            });
          }
          if (result.reason === "paper_tally_already_recorded") {
            return reply.code(409).send({
              error: "paper_tally_already_recorded",
              message:
                "Os totais da urna de papel já foram lançados neste escrutínio. Zere a urna de papel antes de alterar o modo de voto.",
            });
          }
          return reply.code(409).send({
            error: result.reason,
            message: "Não é possível alterar o modo de votação de uma sala encerrada.",
          });
        }

        const room = await options.roomRepository.findRoomById(roomId);
        const basePresence = room
          ? quorumStatus(room, result.onlinePresentCount, result.paperVotersCount)
          : {
              presentCount: result.onlinePresentCount + result.paperVotersCount,
              eligibleCount: 0,
              requiredCount: 0,
              quorumMet: false,
            };
        const presence = {
          ...basePresence,
          onlinePresentCount: result.onlinePresentCount,
          paperVotersCount: result.paperVotersCount,
        };
        options.presencePublisher?.publishPresence(roomId, presence);

        return {
          entry: toRosterEntryResponse(result.entry),
          accessCode: result.accessCode ? toAccessCodeResponse(result.accessCode) : null,
          presence,
        };
      } catch (error) {
        request.log.error({ err: error, roomId, entryId }, "Failed to update roster paper mode");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/candidates",
    { schema: { params: RoomIdParams, body: AddRoomCandidateBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.addRoomCandidate) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as {
        memberId?: string;
        rosterEntryId?: string;
        displayName?: string;
        birthDate?: string | null;
        officeLabel?: string;
      };

      if (body.birthDate !== undefined && body.birthDate !== null && !parseIsoDate(body.birthDate)) {
        return reply.code(400).send({ error: "invalid_birth_date" });
      }

      try {
        const result = await options.roomRepository.addRoomCandidate(roomId, body);
        if (!result.ok) {
          if (
            result.reason === "room_not_found" ||
            result.reason === "member_not_found" ||
            result.reason === "roster_entry_not_found"
          ) {
            return reply.code(404).send({ error: result.reason });
          }
          if (result.reason === "invalid_office" || result.reason === "invalid_candidate") {
            return reply.code(400).send({ error: result.reason });
          }
          if (result.reason === "candidate_exists") {
            return reply.code(409).send({
              error: "candidate_exists",
              message: "Este candidato já está cadastrado na sala.",
            });
          }
          return reply.code(409).send({
            error: "candidates_locked_after_round",
            message: "Candidatos não podem ser alterados após a abertura do 1º escrutínio.",
          });
        }

        return reply.code(201).send({
          candidate: toRoomCandidateResponse(roomId, result.candidate),
          candidates: result.candidates.map((candidate) =>
            toRoomCandidateResponse(roomId, candidate),
          ),
        });
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to add candidate");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.delete(
    "/v1/admin/rooms/:roomId/candidates/:candidateId",
    { schema: { params: CandidateIdParams, querystring: DeleteRoomCandidateQuery } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.removeRoomCandidate) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, candidateId } = request.params as { roomId: string; candidateId: string };
      const query = (request.query ?? {}) as { officeLabel?: string };
      try {
        const result = await options.roomRepository.removeRoomCandidate(
          roomId,
          candidateId,
          query.officeLabel,
        );
        if (!result.ok) {
          if (result.reason === "room_not_found" || result.reason === "candidate_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          if (result.reason === "invalid_office") {
            return reply.code(400).send({ error: result.reason });
          }
          return reply.code(409).send({
            error: "candidates_locked_after_round",
            message: "Candidatos não podem ser alterados após a abertura do 1º escrutínio.",
          });
        }

        return {
          removed: true,
          candidates: result.candidates.map((candidate) =>
            toRoomCandidateResponse(roomId, candidate),
          ),
        };
      } catch (error) {
        request.log.error({ err: error, roomId, candidateId }, "Failed to remove candidate");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get(
    "/v1/admin/rooms/:roomId/entry-requests",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }
      if (!options.roomRepository?.listEntryRequests) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const snapshot = await options.roomRepository.listEntryRequests(roomId);
        if (!snapshot) {
          return reply.code(404).send({ error: "room_not_found" });
        }

        return {
          requests: snapshot.requests.map(toEntryRequestResponse),
          claimedParticipants: snapshot.claimedParticipants.map((participant) => ({
            participantId: participant.participantId,
            rosterEntryId: participant.rosterEntryId,
            displayName: participant.displayName,
            isPresent: participant.isPresent,
            joinedAt: participant.joinedAt.toISOString(),
            disputedAttemptCount: participant.disputedAttemptCount,
            lastDisputedAt: participant.lastDisputedAt
              ? participant.lastDisputedAt.toISOString()
              : null,
          })),
          disputes: snapshot.disputes.map((dispute) => ({
            rosterEntryId: dispute.rosterEntryId,
            displayName: dispute.displayName,
            disputedAttemptCount: dispute.disputedAttemptCount,
            lastDisputedAt: dispute.lastDisputedAt.toISOString(),
            currentHolderStatus: dispute.currentHolderStatus,
            requestId: dispute.requestId,
            participantId: dispute.participantId,
          })),
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to list entry requests");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/entry-requests/:requestId/approve",
    { schema: { params: EntryRequestIdParams } },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin) {
        return;
      }
      if (!options.roomRepository?.approveEntryRequest) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, requestId } = request.params as { roomId: string; requestId: string };
      try {
        const result = await options.roomRepository.approveEntryRequest(
          roomId,
          requestId,
          admin.id,
        );
        if (!result.ok) {
          if (
            result.reason === "room_not_found" ||
            result.reason === "request_not_found" ||
            result.reason === "roster_entry_not_found"
          ) {
            return reply.code(404).send({ error: result.reason });
          }
          const messages: Record<string, string> = {
            room_not_joinable: "A sala não está aberta para entrada de eleitores.",
            request_not_pending: "Este pedido de entrada já foi processado.",
            voter_on_paper: "Este eleitor está marcado para votar em papel.",
            room_capacity_reached: "O limite de participantes da sala foi atingido.",
            session_already_in_use: "Este navegador já possui outra sessão ativa na sala.",
          };
          return reply.code(409).send({
            error: result.reason,
            message: messages[result.reason] ?? "Não foi possível aprovar o pedido.",
          });
        }

        const room = await options.roomRepository.findRoomById(roomId);
        const presence = room ? await loadRoomPresence(options.roomRepository, room) : null;
        if (presence) {
          options.presencePublisher?.publishPresence(roomId, presence);
        }
        options.presencePublisher?.publishEntryRequestsUpdated?.(roomId);

        return {
          request: toEntryRequestResponse(result.request),
          participantId: result.participantId,
          ...(presence ? { presence } : {}),
        };
      } catch (error) {
        request.log.error({ err: error, roomId, requestId }, "Failed to approve entry request");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/entry-requests/approve-all",
    { schema: { params: RoomIdParams } },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin) {
        return;
      }
      if (!options.roomRepository?.approveAllEntryRequests) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      try {
        const result = await options.roomRepository.approveAllEntryRequests(roomId, admin.id);
        if (!result.ok) {
          if (result.reason === "room_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          return reply.code(409).send({
            error: result.reason,
            message:
              result.reason === "room_capacity_reached"
                ? "O limite de participantes da sala foi atingido."
                : "A sala não está aberta para entrada de eleitores.",
          });
        }

        const room = await options.roomRepository.findRoomById(roomId);
        const presence = room ? await loadRoomPresence(options.roomRepository, room) : null;
        if (presence) {
          options.presencePublisher?.publishPresence(roomId, presence);
        }
        options.presencePublisher?.publishEntryRequestsUpdated?.(roomId);

        return {
          approvedCount: result.approvedCount,
          skippedCount: result.skippedCount,
          ...(presence ? { presence } : {}),
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to approve all entry requests");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/entry-requests/:requestId/reject",
    { schema: { params: EntryRequestIdParams } },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin) {
        return;
      }
      if (!options.roomRepository?.rejectEntryRequest) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId, requestId } = request.params as { roomId: string; requestId: string };
      try {
        const result = await options.roomRepository.rejectEntryRequest(
          roomId,
          requestId,
          admin.id,
        );
        if (!result.ok) {
          if (result.reason === "room_not_found" || result.reason === "request_not_found") {
            return reply.code(404).send({ error: result.reason });
          }
          return reply.code(409).send({
            error: result.reason,
            message: "Este pedido de entrada já foi processado.",
          });
        }

        options.presencePublisher?.publishEntryRequestsUpdated?.(roomId);

        return {
          request: toEntryRequestResponse(result.request),
        };
      } catch (error) {
        request.log.error({ err: error, roomId, requestId }, "Failed to reject entry request");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/rooms/:roomId/entry-requests/release-name",
    { schema: { params: RoomIdParams, body: ReleaseClaimedNameBody } },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin) {
        return;
      }
      if (!options.roomRepository?.releaseClaimedName) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { roomId } = request.params as { roomId: string };
      const body = request.body as { rosterEntryId?: string; participantId?: string };
      if (!body.rosterEntryId && !body.participantId) {
        return reply.code(400).send({ error: "invalid_release_target" });
      }

      try {
        const result = await options.roomRepository.releaseClaimedName(roomId, body, admin.id);
        if (!result.ok) {
          return reply.code(404).send({ error: result.reason });
        }

        const room = await options.roomRepository.findRoomById(roomId);
        const presence = room ? await loadRoomPresence(options.roomRepository, room) : null;
        if (presence) {
          options.presencePublisher?.publishPresence(roomId, presence);
        }
        options.presencePublisher?.publishEntryRequestsUpdated?.(roomId);

        return {
          released: true,
          rosterEntryId: result.rosterEntryId,
          participantId: result.participantId,
          displayName: result.displayName,
          ...(presence ? { presence } : {}),
        };
      } catch (error) {
        request.log.error({ err: error, roomId }, "Failed to release claimed name");
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

function toEntryRequestResponse(request: StoredEntryRequest) {
  return {
    id: request.id,
    rosterEntryId: request.rosterEntryId,
    displayName: request.displayName,
    status: request.status,
    disputedAttemptCount: request.disputedAttemptCount,
    lastDisputedAt: request.lastDisputedAt ? request.lastDisputedAt.toISOString() : null,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
  };
}

function toRosterEntryResponse(entry: {
  id: string;
  roomId: string;
  memberId: string | null;
  fullName: string;
  birthDate: string | null;
  isCommunicant: boolean;
  isMale: boolean | null;
  isEligibleVoter: boolean;
  votesOnPaper: boolean;
  createdAt: Date;
  accessCode: { id: string; code: string; revokedAt: Date | null } | null;
  isPresent: boolean;
}) {
  return {
    id: entry.id,
    roomId: entry.roomId,
    memberId: entry.memberId,
    fullName: entry.fullName,
    birthDate: entry.birthDate,
    isCommunicant: entry.isCommunicant,
    isMale: entry.isMale,
    isEligibleVoter: entry.isEligibleVoter,
    votesOnPaper: entry.votesOnPaper,
    createdAt: entry.createdAt.toISOString(),
    accessCode: entry.accessCode
      ? {
          id: entry.accessCode.id,
          code: entry.accessCode.code,
          revokedAt: entry.accessCode.revokedAt ? entry.accessCode.revokedAt.toISOString() : null,
        }
      : null,
    isPresent: entry.isPresent,
  };
}

function toRoomCandidateResponse(roomId: string, candidate: StoredCandidate) {
  return {
    id: candidate.id,
    memberId: candidate.memberId ?? null,
    displayName: candidate.displayName,
    photoUrl: toCandidatePhotoUrl(roomId, candidate.id, candidate.photoUrl),
    birthDate: candidate.birthDate ?? null,
    isEligible: candidate.isEligible,
  };
}

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
    includeCandidateDetails?: boolean;
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
    vacancies: room.vacancies ?? 1,
    entryMode: room.entryMode,
    entryOpen: room.entryOpen,
    maxParticipants: room.maxParticipants,
    effectiveMaxParticipants: resolveRoomMaxParticipants(room),
    showLiveCandidateTally: room.showLiveCandidateTally ?? false,
    shortCode: room.shortCode,
    reactionsEnabled: room.reactionsEnabled,
    chatMuted: room.chatMuted ?? false,
    ...(candidates.length > 0
      ? {
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            displayName: candidate.displayName,
            photoUrl: toCandidatePhotoUrl(room.id, candidate.id, candidate.photoUrl),
            ...(options.includeCandidateDetails
              ? {
                  memberId: candidate.memberId ?? null,
                  isEligible: candidate.isEligible,
                }
              : {}),
          })),
        }
      : {}),
    ...(options.includeInvite
      ? {
          inviteToken: room.inviteToken,
          invitePath: `/join/${room.inviteToken}`,
          shortPath: `/s/${room.shortCode}`,
        }
      : {}),
    majorityRule: preset.majorityRule,
    roundBehavior: preset.roundBehavior,
    createdAt: room.createdAt.toISOString(),
  };
}

function buildLiveRoundTally(input: {
  candidates: StoredCandidate[];
  ballotChoices: readonly BallotChoiceInput[];
  paperTally: StoredPaperTally | null;
  vacancies: number;
  includeStandings: boolean;
}): LiveRoundTally {
  const onlineBallots = input.ballotChoices.length;
  const paperBallots = input.paperTally?.ballotCount ?? 0;
  let onlineBlankVotes = 0;
  for (const choice of input.ballotChoices) {
    if (choice === null || (Array.isArray(choice) && choice.length === 0)) {
      onlineBlankVotes += 1;
    }
  }
  const blankVotes = onlineBlankVotes + (input.paperTally?.blankVotes ?? 0);
  const nullVotes = input.paperTally?.nullVotes ?? 0;

  if (!input.includeStandings || input.candidates.length === 0) {
    return {
      totalBallots: onlineBallots + paperBallots,
      onlineBallots,
      paperBallots,
      blankVotes,
      nullVotes,
    };
  }

  const partial = tallyRoundVotes(input.candidates, input.ballotChoices, {
    vacancies: input.vacancies,
    ...(input.paperTally
      ? {
          paperTally: {
            ballotCount: input.paperTally.ballotCount,
            blankVotes: input.paperTally.blankVotes,
            nullVotes: input.paperTally.nullVotes,
            candidateVotes: input.paperTally.candidateVotes,
          },
        }
      : {}),
  });

  return {
    totalBallots: onlineBallots + paperBallots,
    onlineBallots,
    paperBallots,
    blankVotes,
    nullVotes,
    standings: partial.standings,
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
  const closedRounds = rounds.filter(
    (round) =>
      round.status === "closed" &&
      (round.outcome === "elected" || round.outcome === "no_majority"),
  );
  const paperTallies =
    closedRounds.length > 0 && repository.listRoundPaperTallies
      ? await repository.listRoundPaperTallies(closedRounds.map((round) => round.id))
      : [];
  const paperTallyByRoundId = new Map<string, StoredPaperTally>(
    paperTallies.map((item) => [item.roundId, item]),
  );

  const tallies = new Map<string, RoundTally>();
  for (const round of closedRounds) {
    const primaryCandidates = candidatesByRoom.get(round.roomId) ?? [];
    const fallbackCandidates = fallbackCandidatesByRoom?.get(round.roomId) ?? primaryCandidates;
    if (primaryCandidates.length === 0 && fallbackCandidates.length === 0) {
      continue;
    }
    const ballotChoices: readonly BallotChoiceInput[] = repository.listRoundBallotMarks
      ? await repository.listRoundBallotMarks(round.id)
      : await repository.listRoundBallotCandidateIds(round.id);
    const paperTally = paperTallyByRoundId.get(round.id);
    const primaryIds = new Set(primaryCandidates.map((candidate) => candidate.id));
    const paperVoteIds = paperTally
      ? Object.entries(paperTally.candidateVotes)
          .filter(([, count]) => count > 0)
          .map(([id]) => id)
      : [];
    const usePrimary =
      primaryCandidates.length > 0 &&
      ballotChoices.every((choice) =>
        choice === null
          ? true
          : typeof choice === "string"
            ? primaryIds.has(choice)
            : choice.every((id) => primaryIds.has(id)),
      ) &&
      paperVoteIds.every((id) => primaryIds.has(id));
    const pool = usePrimary ? primaryCandidates : fallbackCandidates;
    const roundNumber = officeRoundNumberByRoundId?.get(round.id) ?? round.number;
    tallies.set(
      round.id,
      tallyRoundVotes(pool, ballotChoices, {
        roundNumber,
        vacancies: round.vacancies ?? 1,
        winnerOverrideId:
          round.tieBreakReason === "admin_tiebreak" ? round.winnerCandidateId : undefined,
        tieBreakReason: round.tieBreakReason,
        ...(round.didNotVoteCount !== undefined && round.didNotVoteCount > 0
          ? { didNotVoteCount: round.didNotVoteCount }
          : {}),
        ...(paperTally
          ? {
              paperTally: {
                ballotCount: paperTally.ballotCount,
                blankVotes: paperTally.blankVotes,
                nullVotes: paperTally.nullVotes,
                candidateVotes: paperTally.candidateVotes,
              },
            }
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
