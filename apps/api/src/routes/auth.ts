import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { normalizeEmail, validateNewAccount } from "../auth/account.js";
import {
  isClientLimited,
  recordClientAttempt,
  clearLoginAccountAttempts,
  releaseLoginAttempt,
  releaseLoginClientAttempt,
  takeLoginAttempt,
  takeLoginClientAttempt,
} from "../auth/auth-attempts.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "../auth/password.js";
import {
  clearSessionCookieHeader,
  createSessionToken,
  readSessionToken,
  sessionCookieHeader,
  sessionExpiry,
} from "../auth/session-cookie.js";
import { env } from "../env.js";
import {
  EmailAlreadyUsedError,
  type PublicUser,
  type UserRepository,
} from "../users/user-repository.js";

const RegisterBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    email: Type.String({ minLength: 3, maxLength: 254 }),
    password: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

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

type RegisterBodyType = CredentialsBody & {
  name: string;
};

export type AuthRouteOptions = {
  userRepository?: UserRepository;
};

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.post(
    "/v1/auth/register",
    { schema: { body: RegisterBody }, attachValidation: true },
    async (request, reply) => {
      if (request.validationError) {
        return reply.code(400).send({ error: "invalid_account" });
      }

      const userRepository = options.userRepository;
      if (!userRepository) {
        return reply.code(503).send({ error: "persistence_unavailable" });
      }

      const clientKey = clientAddress(request);
      if (isClientLimited("register", clientKey)) {
        return reply.code(429).send({ error: "rate_limited" });
      }
      recordClientAttempt("register", clientKey);

      const body = request.body as RegisterBodyType;
      const validated = validateNewAccount(body);
      if (!validated.ok) {
        return reply.code(400).send({ error: "invalid_account", details: validated.issues });
      }

      try {
        const passwordHash = await hashPassword(validated.value.password);
        const user = await userRepository.insertUser({
          name: validated.value.name,
          email: validated.value.email,
          passwordHash,
          role: "member",
        });
        await startSession(reply, userRepository, user);
        return reply.code(201).send({ user });
      } catch (error) {
        if (error instanceof EmailAlreadyUsedError) {
          return reply.code(409).send({ error: "email_taken" });
        }
        request.log.error({ err: error }, "Failed to register user");
        return reply.code(500).send({ error: "persistence_failed" });
      }
    },
  );

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
