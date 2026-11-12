import type { FastifyPluginAsync } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  hasReachedQuorum,
  nextRoundPlan,
  type RulesPreset,
  type TallyEntry,
} from "@scelta/domain";

const QuorumBody = Type.Object({
  presentCount: Type.Integer({ minimum: 0 }),
  eligibleCount: Type.Integer({ minimum: 0 }),
  quorumValue: Type.Number({ minimum: 0 }),
  quorumUnit: Type.Union([Type.Literal("absolute"), Type.Literal("percent")]),
});

const RoundPlanBody = Type.Object({
  roundNumber: Type.Integer({ minimum: 1 }),
  preset: Type.Union([
    Type.Literal("ipb_local_officers"),
    Type.Literal("ipb_society_board"),
    Type.Literal("custom"),
  ]),
  vacancies: Type.Optional(Type.Integer({ minimum: 1 })),
  tallies: Type.Array(
    Type.Object({
      candidateId: Type.String({ minLength: 1 }),
      votes: Type.Integer({ minimum: 0 }),
    }),
  ),
});

export const rulesRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/rules/quorum",
    {
      schema: {
        body: QuorumBody,
      },
    },
    async (request) => {
      const body = request.body as {
        presentCount: number;
        eligibleCount: number;
        quorumValue: number;
        quorumUnit: "absolute" | "percent";
      };

      return {
        reached: hasReachedQuorum(body),
      };
    },
  );

  app.post(
    "/v1/rules/round-plan",
    {
      schema: {
        body: RoundPlanBody,
      },
    },
    async (request) => {
      const body = request.body as {
        roundNumber: number;
        preset: RulesPreset;
        vacancies?: number;
        tallies: TallyEntry[];
      };

      return nextRoundPlan(body);
    },
  );
};
