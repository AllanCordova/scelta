import {
  parseIsoDate,
  parseMemberImportCsv,
  suggestCandidates,
  type RoomType,
} from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../auth/require-admin.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import type { UserRepository } from "../users/user-repository.js";

const ImportMembersBody = Type.Object(
  {
    csv: Type.String({ minLength: 1, maxLength: 200_000 }),
  },
  { additionalProperties: false },
);

const SuggestionsQuery = Type.Object(
  {
    roomType: Type.Union([
      Type.Literal("pastor"),
      Type.Literal("elder"),
      Type.Literal("deacon"),
      Type.Literal("session_board"),
      Type.Literal("upa_board"),
      Type.Literal("ump_board"),
      Type.Literal("custom"),
    ]),
    referenceDate: Type.Optional(Type.String({ minLength: 10, maxLength: 10 })),
    minAgeYears: Type.Optional(Type.Integer({ minimum: 0, maximum: 120 })),
    minSocietyMonths: Type.Optional(Type.Integer({ minimum: 0, maximum: 600 })),
    requireMaleForOfficers: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

type ImportMembersBodyType = {
  csv: string;
};

type SuggestionsQueryType = {
  roomType: RoomType;
  referenceDate?: string;
  minAgeYears?: number;
  minSocietyMonths?: number;
  requireMaleForOfficers?: boolean;
};

export type MemberRouteOptions = {
  roomRepository?: RoomRepository;
  userRepository?: UserRepository;
};

export const memberRoutes: FastifyPluginAsync<MemberRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post(
    "/v1/admin/members/import",
    { schema: { body: ImportMembersBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const body = request.body as ImportMembersBodyType;
      const parsed = parseMemberImportCsv(body.csv);
      if (parsed.validRows.length === 0 && parsed.rejectedRows.length === 0) {
        return reply.code(400).send({ error: "empty_import" });
      }

      try {
        const persisted = await options.roomRepository.importMembers(parsed.validRows);
        return {
          report: {
            createdCount: persisted.createdCount,
            updatedCount: persisted.updatedCount,
            rejectedCount: parsed.rejectedRows.length,
            rejectedRows: parsed.rejectedRows,
          },
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to import members");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.get("/v1/admin/members", async (request, reply) => {
    if (!(await requireAdmin(request, reply, options.userRepository))) {
      return;
    }

    if (!options.roomRepository) {
      return reply.code(503).send({ error: "persistence_unavailable" });
    }

    try {
      const stored = await options.roomRepository.listMembers();
      return {
        members: stored.map((member) => ({
          id: member.id,
          fullName: member.fullName,
          isCommunicant: member.isCommunicant,
          isMale: member.isMale,
          birthDate: member.birthDate,
          societyFlags: member.societyFlags,
        })),
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to list members");
      return reply.code(500).send({ error: "persistence_failed" });
    }
  });

  app.get(
    "/v1/admin/members/suggestions",
    { schema: { querystring: SuggestionsQuery } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const query = request.query as SuggestionsQueryType;
      if (query.referenceDate !== undefined && !parseIsoDate(query.referenceDate)) {
        return reply.code(400).send({ error: "invalid_reference_date" });
      }

      try {
        const stored = await options.roomRepository.listMembers();
        const suggestions = suggestCandidates(stored, {
          roomType: query.roomType,
          ...(query.referenceDate !== undefined ? { referenceDate: query.referenceDate } : {}),
          ...(query.minAgeYears !== undefined ? { minAgeYears: query.minAgeYears } : {}),
          ...(query.minSocietyMonths !== undefined
            ? { minSocietyMonths: query.minSocietyMonths }
            : {}),
          ...(query.requireMaleForOfficers !== undefined
            ? { requireMaleForOfficers: query.requireMaleForOfficers }
            : {}),
        });
        return { suggestions };
      } catch (error) {
        request.log.error({ err: error }, "Failed to suggest candidates");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );
};
