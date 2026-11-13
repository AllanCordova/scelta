import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { env } from "./env.js";
import type { PresencePublisher } from "./realtime.js";
import type { UserRepository } from "./users/user-repository.js";
import { authRoutes } from "./routes/auth.js";
import { ballotRoutes } from "./routes/ballots.js";
import { healthRoutes } from "./routes/health.js";
import { joinRoutes } from "./routes/join.js";
import { roomRoutes, type RoomRouteOptions } from "./routes/rooms.js";
import { roundRoutes } from "./routes/rounds.js";
import { rulesRoutes } from "./routes/rules.js";

export type AppDependencies = {
  roomRepository?: RoomRouteOptions["roomRepository"];
  userRepository?: UserRepository;
  presencePublisher?: PresencePublisher;
};

export async function buildApp(dependencies: AppDependencies = {}) {
  const app = Fastify({
    // Trust forwarded headers only from loopback and private addresses (the Compose
    // nginx). A client on the published API port cannot forge its address.
    trustProxy: "loopback, uniquelocal",
    logger: {
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    },
  });

  await app.register(cors, {
    origin: env.corsOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type"],
  });
  await app.register(sensible);
  await app.register(healthRoutes);
  await app.register(rulesRoutes);
  await app.register(authRoutes, {
    userRepository: dependencies.userRepository,
  });
  await app.register(roomRoutes, {
    roomRepository: dependencies.roomRepository,
    userRepository: dependencies.userRepository,
  });
  await app.register(roundRoutes, {
    roomRepository: dependencies.roomRepository,
    userRepository: dependencies.userRepository,
  });
  await app.register(joinRoutes, {
    roomRepository: dependencies.roomRepository,
    presencePublisher: dependencies.presencePublisher,
  });
  await app.register(ballotRoutes, {
    roomRepository: dependencies.roomRepository,
  });

  return app;
}
