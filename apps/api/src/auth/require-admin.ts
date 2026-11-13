import type { FastifyReply, FastifyRequest } from "fastify";
import type { PublicUser, UserRepository } from "../users/user-repository.js";
import { readSessionToken } from "./session-cookie.js";

/**
 * Gate for the admin console. Join, presence, and ballot routes must not use
 * this: a vote stays anonymous and does not require a login.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  userRepository: UserRepository | undefined,
): Promise<PublicUser | undefined> {
  if (!userRepository) {
    await reply.code(503).send({ error: "persistence_unavailable" });
    return undefined;
  }

  const user = await userRepository.findBySessionToken(readSessionToken(request.headers.cookie));
  if (!user) {
    await reply.code(401).send({ error: "unauthorized" });
    return undefined;
  }

  if (user.role !== "admin") {
    await reply.code(403).send({ error: "forbidden" });
    return undefined;
  }

  return user;
}
