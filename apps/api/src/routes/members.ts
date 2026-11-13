import {
  hasConflictingSocietyFlags,
  parseIsoDate,
  parseMemberImportCsv,
  parsePhotoUrl,
  suggestCandidates,
  type MemberSocietyFlags,
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

const ListMembersQuery = Type.Object(
  {
    search: Type.Optional(Type.String({ maxLength: 120 })),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

const CreateMemberBody = Type.Object(
  {
    fullName: Type.String({ minLength: 2, maxLength: 120 }),
    isCommunicant: Type.Boolean(),
    isMale: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    birthDate: Type.Optional(Type.Union([Type.String({ minLength: 10, maxLength: 10 }), Type.Null()])),
    photoUrl: Type.Optional(Type.Union([Type.String({ maxLength: 12_000_000 }), Type.Null()])),
    societyFlags: Type.Optional(
      Type.Object(
        {
          upaActive: Type.Optional(Type.Boolean()),
          umpActive: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const MemberIdParams = Type.Object({
  memberId: Type.String({
    minLength: 36,
    maxLength: 36,
    pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  }),
});

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

type ListMembersQueryType = {
  search?: string;
  page?: number;
  pageSize?: number;
};

type CreateMemberBodyType = {
  fullName: string;
  isCommunicant: boolean;
  isMale?: boolean | null;
  birthDate?: string | null;
  photoUrl?: string | null;
  societyFlags?: {
    upaActive?: boolean;
    umpActive?: boolean;
  };
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

  app.get(
    "/v1/admin/members",
    { schema: { querystring: ListMembersQuery } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const query = (request.query ?? {}) as ListMembersQueryType;
      const search = query.search?.trim().toLocaleLowerCase() ?? "";

      try {
        const stored = await options.roomRepository.listMembers();
        const filtered =
          search.length > 0
            ? stored.filter((member) => member.fullName.toLocaleLowerCase().includes(search))
            : stored;

        const total = filtered.length;
        const shouldPaginate = query.page !== undefined || query.pageSize !== undefined;
        const pageSize = shouldPaginate ? (query.pageSize ?? 20) : Math.max(total, 1);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const page = shouldPaginate ? Math.min(query.page ?? 1, totalPages) : 1;
        const offset = (page - 1) * pageSize;
        const pageItems = shouldPaginate ? filtered.slice(offset, offset + pageSize) : filtered;

        return {
          members: pageItems.map((member) => ({
            id: member.id,
            fullName: member.fullName,
            isCommunicant: member.isCommunicant,
            isMale: member.isMale,
            birthDate: member.birthDate,
            photoUrl: member.photoUrl,
            societyFlags: member.societyFlags,
          })),
          total,
          page,
          pageSize,
          totalPages,
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to list members");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post(
    "/v1/admin/members",
    { bodyLimit: 12 * 1024 * 1024, schema: { body: CreateMemberBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const validated = validateMemberInput(request.body as CreateMemberBodyType);
      if (!validated.ok) {
        return reply.code(400).send({ error: validated.error });
      }

      try {
        const created = await options.roomRepository.createMember(validated.value);
        return reply.code(201).send({
          member: serializeMember(created),
        });
      } catch (error) {
        request.log.error({ err: error }, "Failed to create member");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.patch(
    "/v1/admin/members/:memberId",
    { bodyLimit: 12 * 1024 * 1024, schema: { params: MemberIdParams, body: CreateMemberBody } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const validated = validateMemberInput(request.body as CreateMemberBodyType);
      if (!validated.ok) {
        return reply.code(400).send({ error: validated.error });
      }

      const { memberId } = request.params as { memberId: string };
      try {
        const updated = await options.roomRepository.updateMember(memberId, validated.value);
        if (!updated) {
          return reply.code(404).send({ error: "member_not_found" });
        }
        return {
          member: serializeMember(updated),
        };
      } catch (error) {
        request.log.error({ err: error }, "Failed to update member");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.delete(
    "/v1/admin/members/:memberId",
    { schema: { params: MemberIdParams } },
    async (request, reply) => {
      if (!(await requireAdmin(request, reply, options.userRepository))) {
        return;
      }

      if (!options.roomRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const { memberId } = request.params as { memberId: string };
      try {
        const deleted = await options.roomRepository.deleteMember(memberId);
        if (!deleted) {
          return reply.code(404).send({ error: "member_not_found" });
        }
        return { deleted: true };
      } catch (error) {
        request.log.error({ err: error }, "Failed to delete member");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

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

function validateMemberInput(body: CreateMemberBodyType):
  | {
      ok: true;
      value: {
        fullName: string;
        isCommunicant: boolean;
        isMale: boolean | null;
        birthDate: string | null;
        photoUrl: string | null;
        societyFlags: MemberSocietyFlags;
      };
    }
  | { ok: false; error: string } {
  const fullName = body.fullName.trim();
  if (fullName.length < 2) {
    return { ok: false, error: "invalid_member_name" };
  }

  const birthDate = body.birthDate ?? null;
  if (birthDate !== null && !parseIsoDate(birthDate)) {
    return { ok: false, error: "invalid_birth_date" };
  }

  const photoParsed = parsePhotoUrl(body.photoUrl);
  if (!photoParsed.ok) {
    return { ok: false, error: "invalid_photo_url" };
  }

  const societyFlags: MemberSocietyFlags = {
    ...(body.societyFlags?.upaActive !== undefined
      ? { upaActive: body.societyFlags.upaActive }
      : {}),
    ...(body.societyFlags?.umpActive !== undefined
      ? { umpActive: body.societyFlags.umpActive }
      : {}),
  };
  if (hasConflictingSocietyFlags(societyFlags)) {
    return { ok: false, error: "conflicting_societies" };
  }

  return {
    ok: true,
    value: {
      fullName,
      isCommunicant: body.isCommunicant,
      isMale: body.isMale ?? null,
      birthDate,
      photoUrl: photoParsed.value,
      societyFlags,
    },
  };
}

function serializeMember(member: {
  id: string;
  fullName: string;
  isCommunicant: boolean;
  isMale: boolean | null;
  birthDate: string | null;
  photoUrl?: string | null;
  societyFlags: MemberSocietyFlags;
}) {
  return {
    id: member.id,
    fullName: member.fullName,
    isCommunicant: member.isCommunicant,
    isMale: member.isMale,
    birthDate: member.birthDate,
    photoUrl: member.photoUrl,
    societyFlags: member.societyFlags,
  };
}
