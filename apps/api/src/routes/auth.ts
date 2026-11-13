import { parsePhotoUrl } from "@scelta/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { normalizeEmail } from "../auth/account.js";
import { requireAdmin } from "../auth/require-admin.js";
import {
  clearLoginAccountAttempts,
  releaseLoginAttempt,
  releaseLoginClientAttempt,
  takeLoginAttempt,
  takeLoginClientAttempt,
} from "../auth/auth-attempts.js";
import { dummyPasswordHash, verifyPassword } from "../auth/password.js";
import {
  clearSessionCookieHeader,
  createSessionToken,
  readSessionToken,
  sessionCookieHeader,
  sessionExpiry,
} from "../auth/session-cookie.js";
import { env } from "../env.js";
import { type PublicUser, type UserRepository } from "../users/user-repository.js";

const LoginBody = Type.Object(
  {
    email: Type.String({ minLength: 1, maxLength: 254 }),
    password: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

type CredentialsBody = {
  email: string;
  password: string;
};

export type AuthRouteOptions = {
  userRepository?: UserRepository;
};

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post(
    "/v1/auth/login",
    { schema: { body: LoginBody }, attachValidation: true },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send({ error: "invalid_account" });
      }

      const userRepository = options.userRepository;
      if (!userRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const body = request.body as CredentialsBody;
      const email = normalizeEmail(body.email);
      const clientKey = clientAddress(request);
      if (!takeLoginClientAttempt(clientKey)) {
        return reply.code(429).send({ error: "rate_limited" });
      }
      if (!takeLoginAttempt(email)) {
        releaseLoginClientAttempt(clientKey);
        return reply.code(429).send({ error: "rate_limited" });
      }

      try {
        const account = await userRepository.findByEmail(email);
        const passwordHash = account?.passwordHash ?? (await dummyPasswordHash());
        const matches = await verifyPassword(body.password, passwordHash);
        if (!account || !matches) {
          return reply.code(401).send({ error: "invalid_credentials" });
        }

        clearLoginAccountAttempts(email);
        releaseLoginClientAttempt(clientKey);
        await startSession(reply, userRepository, {
          id: account.id,
          name: account.name,
          email: account.email,
          role: account.role,
        });
        return {
          user: {
            id: account.id,
            name: account.name,
            email: account.email,
            role: account.role,
          },
        };
      } catch (error) {
        releaseLoginAttempt(email);
        releaseLoginClientAttempt(clientKey);
        request.log.error({ err: error }, "Failed to login");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = readSessionToken(request.headers.cookie);
    if (token && options.userRepository) {
      await options.userRepository.deleteSession(token);
    }
    reply.header("set-cookie", clearSessionCookieHeader(secureCookie()));
    return reply.code(204).send();
  });

  app.get("/v1/auth/me", async (request, reply) => {
    if (!options.userRepository) {
      return reply.code(503).send({ error: "persistence_unavailable" });
    }

    const user = await options.userRepository.findBySessionToken(
      readSessionToken(request.headers.cookie),
    );
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    return { user };
  });

  app.patch(
    "/v1/admin/profile",
    {
      bodyLimit: 12 * 1024 * 1024,
      schema: {
        body: Type.Object(
          {
            name: Type.String({ minLength: 2, maxLength: 120 }),
            photoUrl: Type.Optional(Type.Union([Type.String({ maxLength: 12_000_000 }), Type.Null()])),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, options.userRepository);
      if (!admin || !options.userRepository?.updateUserProfile) {
        return;
      }

      const body = request.body as { name: string; photoUrl?: string | null };
      const trimmedName = body.name.trim();
      if (trimmedName.length < 2) {
        return reply.code(400).send({ error: "invalid_name" });
      }

      const photoParsed = parsePhotoUrl(body.photoUrl);
      if (!photoParsed.ok) {
        return reply.code(400).send({ error: "invalid_photo_url" });
      }

      const updated = await options.userRepository.updateUserProfile(admin.id, {
        name: trimmedName,
        photoUrl: photoParsed.value,
      });
      if (!updated) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      return { user: updated };
    },
  );
};

async function startSession(
  reply: FastifyReply,
  userRepository: UserRepository,
  user: PublicUser,
): Promise<void> {
  const token = createSessionToken();
  await userRepository.createSession(user.id, token, sessionExpiry());
  reply.header("set-cookie", sessionCookieHeader(token, secureCookie()));
}

function secureCookie(): boolean {
  return env.nodeEnv === "production";
}

function clientAddress(request: FastifyRequest): string {
  return request.ip || "unknown";
}
