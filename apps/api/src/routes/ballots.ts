import {
  ALLOWED_REACTION_EMOJIS,
  canOpenRound,
  countOfficeRoundNumber,
  evaluateMultiVacancyProgress,
  tallyRoundVotes,
  type BallotChoiceInput,
  type RoundTally,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import type { PresencePublisher } from "../realtime.js";
import { hashJoinKey } from "../rooms/join-key.js";
import { loadRoomOfficeState } from "../rooms/office-state.js";
import type { RoomRepository, StoredRound } from "../rooms/room-repository.js";
import { toRoundSummary } from "../rooms/round-summary.js";
import { toCandidatePhotoUrl, toPublicOfficeBanners } from "./media.js";
import {
  BALLOT_BURST_RATE_LIMIT,
  BALLOT_RATE_LIMIT,
  enforceRateLimit,
} from "../security/rate-limiter.js";

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
    candidateId: Type.Optional(Type.Union([Uuid, Type.Null()])),
    candidateIds: Type.Optional(Type.Array(Uuid, { maxItems: 50 })),
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
  candidateId?: string | null;
  candidateIds?: string[];
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
        const shouldLoadCurrentTally =
          round &&
          round.status === "closed" &&
          (round.outcome === "elected" || round.outcome === "no_majority") &&
          allCandidates.length > 0;

        const [ballotChoices, paperTally, officeState] = await Promise.all([
          shouldLoadCurrentTally
            ? repository.listRoundBallotMarks
              ? repository.listRoundBallotMarks(round.id)
              : repository.listRoundBallotCandidateIds(round.id)
            : Promise.resolve(null),
          shouldLoadCurrentTally && repository.findRoundPaperTally
            ? repository.findRoundPaperTally(round.id)
            : Promise.resolve(null),
          loadRoomOfficeState(repository, room, allCandidates, allRounds),
        ]);

        let tally: RoundTally | null = null;
        if (shouldLoadCurrentTally && ballotChoices) {
          const eligibleIds = new Set(candidates.map((candidate) => candidate.id));
          const paperVoteIds = paperTally
            ? Object.entries(paperTally.candidateVotes)
                .filter(([, count]) => count > 0)
                .map(([id]) => id)
            : [];
          const useEligibleOnly =
            candidates.length > 0 &&
            ballotChoices.every((choice) => ballotChoiceUsesPool(choice, eligibleIds)) &&
            paperVoteIds.every((id) => eligibleIds.has(id));
          tally = tallyRoundVotes(
            useEligibleOnly ? candidates : allCandidates,
            ballotChoices,
            {
              roundNumber: officeRoundNumber,
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
            },
          );
        }

        const vacancyProgress = evaluateMultiVacancyProgress(room.vacancies ?? 1, allRounds);
        const electedCandidates = vacancyProgress.electedCandidateIds
          .map((id) => allCandidates.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is (typeof allCandidates)[number] => Boolean(candidate))
          .map((candidate) => ({
            id: candidate.id,
            displayName: candidate.displayName,
            photoUrl: toCandidatePhotoUrl(room.id, candidate.id, candidate.photoUrl),
          }));

        const officeBanners = toPublicOfficeBanners(room.id, room.officeBanners);
        const activeBannerUrl = round?.officeLabel
          ? (officeBanners[round.officeLabel] ?? null)
          : (officeBanners.default ?? null);

        return {
          roomId: room.id,
          roomStatus: room.status,
          roomType: room.roomType,
          vacancies: room.vacancies ?? 1,
          remainingVacancies: vacancyProgress.remainingVacancies,
          electedCandidates,
          officeBanners,
          activeBannerUrl,
          reactionsEnabled: room.reactionsEnabled,
          chatMuted: room.chatMuted ?? false,
          viewerAccess,
          allowedReactions: ALLOWED_REACTION_EMOJIS,
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            displayName: candidate.displayName,
            photoUrl: toCandidatePhotoUrl(room.id, candidate.id, candidate.photoUrl),
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
                winnerPhotoUrl: winnerCandidate
                  ? toCandidatePhotoUrl(room.id, winnerCandidate.id, winnerCandidate.photoUrl)
                  : null,
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
      const joinKeyHash = hashJoinKey(joinKey);
      if (
        !(await enforceRateLimit(request, reply, BALLOT_BURST_RATE_LIMIT, token)) ||
        !(await enforceRateLimit(request, reply, BALLOT_RATE_LIMIT, `${token}:${joinKeyHash}`))
      ) {
        return;
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

        const hasCandidateId = body.candidateId !== undefined;
        const hasCandidateIds = body.candidateIds !== undefined;
        if (hasCandidateId === hasCandidateIds) {
          return reply.code(400).send({ error: "invalid_ballot_payload" });
        }

        const result = await repository.castBallot({
          roomId: room.id,
          roundId: round.id,
          joinKeyHash: hashJoinKey(joinKey),
          ...(hasCandidateIds ? { candidateIds: body.candidateIds } : { candidateId: body.candidateId }),
        });

        if (!result.ok) {
          if (
            result.reason === "participant_not_present" ||
            result.reason === "access_code_revoked"
          ) {
            return reply.code(403).send({ error: result.reason });
          }
          if (
            result.reason === "invalid_candidate" ||
            result.reason === "too_many_marks" ||
            result.reason === "duplicate_candidate_mark"
          ) {
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

function ballotChoiceUsesPool(choice: BallotChoiceInput, pool: ReadonlySet<string>): boolean {
  if (choice === null) {
    return true;
  }
  if (typeof choice === "string") {
    return pool.has(choice);
  }
  return choice.every((id) => pool.has(id));
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
