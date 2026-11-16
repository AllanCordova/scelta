import {
  ALLOWED_REACTION_EMOJIS,
  canOpenRound,
  countOfficeRoundNumber,
  tallyRoundVotes,
  type RoundTally,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import type { PresencePublisher } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import { loadRoomOfficeState } from "../rooms/office-state.js";
import type { RoomRepository, StoredRound } from "../rooms/room-repository.js";
import { toRoundSummary } from "../rooms/round-summary.js";

const TokenParams = Type.Object({
  token: Type.String({ minLength: 1, maxLength: 200 }),
});

const Uuid = Type.String({
  minLength: 36,
  maxLength: 36,
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});

const CastBallotBody = Type.Object(
  {
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
    candidateId: Type.Union([Uuid, Type.Null()]),
  },
  { additionalProperties: false },
);

const ReceiptCheckBody = Type.Object(
  {
    joinKey: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

type CastBallotBodyType = {
  joinKey: string;
  candidateId: string | null;
};

type ReceiptCheckBodyType = {
  joinKey: string;
};

export type BallotRouteOptions = {
  roomRepository?: RoomRepository;
  presencePublisher?: PresencePublisher;
};

export const ballotRoutes: FastifyPluginAsync<BallotRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.get(
    "/v1/join/:token/ballot",
    { schema: { params: TokenParams } },
    async (request, reply) => {
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

        const joinKey = readJoinKeyHeader(request.headers["x-scelta-join-key"]);
        const [candidates, allCandidates, allRounds, viewerAccess] = await Promise.all([
          repository.listCandidates(room.id),
          repository.listAllCandidates(room.id),
          repository.listRounds(room.id),
          joinKey && repository.describeVoterSession
            ? repository.describeVoterSession(room.id, hashJoinKey(joinKey))
            : Promise.resolve("unknown" as const),
        ]);
        const round = selectCurrentRound(allRounds);
        const officeRoundNumber = round ? countOfficeRoundNumber(allRounds, round) : undefined;
        let tally: RoundTally | null = null;

        if (
          round &&
          round.status === "closed" &&
          (round.outcome === "elected" || round.outcome === "no_majority") &&
          allCandidates.length > 0
        ) {
          const ballotCandidateIds = await repository.listRoundBallotCandidateIds(round.id);
          const eligibleIds = new Set(candidates.map((candidate) => candidate.id));
          const useEligibleOnly =
            candidates.length > 0 &&
            ballotCandidateIds.every((id) => id === null || eligibleIds.has(id));
          tally = tallyRoundVotes(
            useEligibleOnly ? candidates : allCandidates,
            ballotCandidateIds,
            {
              roundNumber: officeRoundNumber,
              winnerOverrideId: round.winnerCandidateId,
              tieBreakReason: round.tieBreakReason,
            },
          );
        }

        const officeState = await loadRoomOfficeState(repository, room, allCandidates, allRounds);
        const officeBanners = room.officeBanners ?? {};
        const activeBannerUrl = round?.officeLabel
          ? (officeBanners[round.officeLabel] ?? null)
          : (officeBanners.default ?? null);

        return {
          roomId: room.id,
          roomStatus: room.status,
          roomType: room.roomType,
          officeBanners,
          activeBannerUrl,
          reactionsEnabled: room.reactionsEnabled,
          chatMuted: room.chatMuted ?? false,
          viewerAccess,
          allowedReactions: ALLOWED_REACTION_EMOJIS,
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            displayName: candidate.displayName,
            photoUrl: candidate.photoUrl ?? null,
          })),
          offices: officeState.offices.map(
            ({ officeLabel, order, status, winnerCandidateId, winnerName }) => {
              const winnerCandidate = winnerCandidateId
                ? allCandidates.find((candidate) => candidate.id === winnerCandidateId)
                : undefined;
              return {
                officeLabel,
                order,
                status,
                winnerName,
                winnerPhotoUrl: winnerCandidate?.photoUrl ?? null,
                bannerUrl: officeBanners[officeLabel] ?? null,
              };
            },
          ),
          round: toRoundSummary(round, tally, officeRoundNumber),
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to load ballot state");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/:token/ballot/receipt",
    { schema: { params: TokenParams, body: ReceiptCheckBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const body = request.body as ReceiptCheckBodyType;
      const joinKey = body.joinKey.trim();
      if (joinKey.length === 0) {
        return reply.code(400).send({ error: "invalid_join_key" });
      }

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }

        const round = selectCurrentRound(await repository.listRounds(room.id));
        if (!round || round.status !== "open") {
          return { roundId: null, hasVoted: false };
        }

        const hasVoted = await repository.hasVotedInRound(
          room.id,
          round.id,
          hashJoinKey(joinKey),
        );
        return { roundId: round.id, hasVoted };
      } catch (error) {
        request.log.error({ err: error }, "Failed to check vote receipt");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/join/:token/ballot",
    { schema: { params: TokenParams, body: CastBallotBody } },
    async (request, reply) => {
      const repository = options.roomRepository;
      if (!repository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { token } = request.params as { token: string };
      const body = request.body as CastBallotBodyType;
      const joinKey = body.joinKey.trim();
      if (joinKey.length === 0) {
        return reply.code(400).send({ error: "invalid_join_key" });
      }

      try {
        const room = await repository.findRoomByInviteToken(token);
        if (!room) {
          return reply.code(404).send({ error: "invite_not_found" });
        }
        if (!canOpenRound(room.status)) {
          return reply.code(409).send({ error: "room_not_open" });
        }

        const round = selectCurrentRound(await repository.listRounds(room.id));
        if (!round || round.status !== "open") {
          return reply.code(409).send({ error: "round_not_open" });
        }

        const result = await repository.castBallot({
          roomId: room.id,
          roundId: round.id,
          joinKeyHash: hashJoinKey(joinKey),
          candidateId: body.candidateId,
        });

        if (!result.ok) {
          if (
            result.reason === "participant_not_present" ||
            result.reason === "access_code_revoked"
          ) {
            return reply.code(403).send({ error: result.reason });
          }
          if (result.reason === "invalid_candidate") {
            return reply.code(400).send({ error: result.reason });
          }
          return reply.code(409).send({ error: result.reason });
        }

        options.presencePublisher?.publishBallotActivity?.(room.id, round.id);

        return reply.code(201).send({
          receipt: {
            roundId: round.id,
            roundNumber: round.number,
            voted: true,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to cast ballot");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};

const JOIN_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function readJoinKeyHeader(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return null;
  }
  const joinKey = raw.trim();
  if (joinKey.length < 16 || joinKey.length > 128 || !JOIN_KEY_PATTERN.test(joinKey)) {
    return null;
  }
  return joinKey;
}

/** Prefer the open round everyone should be voting in, even if a later number is already closed. */
function selectCurrentRound(allRounds: StoredRound[]): StoredRound | null {
  for (let index = allRounds.length - 1; index >= 0; index -= 1) {
    const round = allRounds[index];
    if (round?.status === "open") {
      return round;
    }
  }
  return allRounds[allRounds.length - 1] ?? null;
}
