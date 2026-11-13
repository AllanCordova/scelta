import { parseMemberImportCsv } from "@scelta/domain";
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

type ImportMembersBodyType = {
  csv: string;
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
};
