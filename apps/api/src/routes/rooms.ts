import {
  countOfficeRoundNumber,
  findPreset,
  isMemberEligibleForRoomType,
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
    status: Type.Optional(Type.Union([Type.Literal("draft"), Type.Literal("open")])),
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

        const [roomCandidates, allCandidates, allRounds, presentCount] = await Promise.all([
          options.roomRepository.listCandidates(roomId),
          options.roomRepository.listAllCandidates(roomId),
          options.roomRepository.listRounds(roomId),
          options.roomRepository.countPresent(roomId),
        ]);
        const round = allRounds[allRounds.length - 1] ?? null;
        const candidatesByRoom = new Map([[roomId, allCandidates]]);
        const tallyByRound = await loadTalliesForClosedRounds(
          options.roomRepository,
          round ? [round] : [],
          candidatesByRoom,
        );
        const [receiptDates, officeState] = await Promise.all([
          round
            ? options.roomRepository.listRoundReceiptTimestamps(round.id)
            : Promise.resolve([]),
          loadRoomOfficeState(options.roomRepository, room, allCandidates, allRounds),
        ]);
        const officeRoundNumber = round ? countOfficeRoundNumber(allRounds, round) : undefined;

        return {
          room: {
            ...toRoomResponse(room, { includeInvite: true, candidates: roomCandidates }),
            presence: quorumStatus(room, presentCount),
            votedCount: receiptDates.length,
            receiptTimestamps: receiptDates.map((date) => date.toISOString()),
            offices: officeState.offices,
            recommendedOffice: officeState.recommendedOffice,
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
    status: room.status,
    ...(candidates.length > 0
      ? {
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            displayName: candidate.displayName,
            photoUrl: candidate.photoUrl ?? null,
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
): Promise<Map<string, RoundTally>> {
  const tallies = new Map<string, RoundTally>();
  for (const round of rounds) {
    if (round.status !== "closed") {
      continue;
    }
    if (round.outcome !== "elected" && round.outcome !== "no_majority") {
      continue;
    }
    const candidates = candidatesByRoom.get(round.roomId) ?? [];
    if (candidates.length === 0) {
      continue;
    }
    const ballotCandidateIds = await repository.listRoundBallotCandidateIds(round.id);
    tallies.set(round.id, tallyRoundVotes(candidates, ballotCandidateIds));
  }
  return tallies;
}
