import { createPgliteDatabase, createPostgresDatabase } from "@scelta/db";
import { assertAdminAccountConfig } from "./auth/admin-account.js";
import { env } from "./env.js";
import { buildApp } from "./app.js";
import { attachRealtime, createSocketPresencePublisher, type PresencePublisher } from "./realtime.js";
import { createDrizzleRoomRepository } from "./rooms/drizzle-room-repository.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import { ensureBootstrapAdmin } from "./users/bootstrap-admin.js";
import { createDrizzleUserRepository } from "./users/drizzle-user-repository.js";
import type { UserRepository } from "./users/user-repository.js";

async function main() {
  assertAdminAccountConfig(env.nodeEnv, env.adminEmail, env.adminPassword);
  const database = await openDatabase();
  const roomRepository: RoomRepository | undefined = database
    ? createDrizzleRoomRepository(database.db, env.churchName)
    : undefined;
  const userRepository: UserRepository | undefined = database
    ? createDrizzleUserRepository(database.db, env.churchName)
    : undefined;

  if (userRepository && env.adminEmail && env.adminPassword) {
    await ensureBootstrapAdmin(userRepository, {
      name: env.adminName,
      email: env.adminEmail,
      password: env.adminPassword,
    });
  }

  const presenceSink: { current?: PresencePublisher } = {};
  const presencePublisher: PresencePublisher = {
    publishPresence(roomId, presence) {
      presenceSink.current?.publishPresence(roomId, presence);
    },
    publishRoundState(roomId, roundState) {
      presenceSink.current?.publishRoundState?.(roomId, roundState);
    },
    publishBallotActivity(roomId, roundId) {
      presenceSink.current?.publishBallotActivity?.(roomId, roundId);
    },
    publishReaction(roomId, reaction) {
      presenceSink.current?.publishReaction?.(roomId, reaction);
    },
    publishReactionsConfig(roomId, reactionsEnabled) {
      presenceSink.current?.publishReactionsConfig?.(roomId, reactionsEnabled);
    },
    publishChatMessage(roomId, message) {
      presenceSink.current?.publishChatMessage?.(roomId, message);
    },
    publishChatConfig(roomId, config) {
      presenceSink.current?.publishChatConfig?.(roomId, config);
    },
    publishChatMessageDeleted(roomId, messageId) {
      presenceSink.current?.publishChatMessageDeleted?.(roomId, messageId);
    },
  };
  const app = await buildApp({ roomRepository, userRepository, presencePublisher });
  await app.ready();
  presenceSink.current = createSocketPresencePublisher(attachRealtime(app.server, env.corsOrigin));

  await app.listen({
    host: env.host,
    port: env.port,
  });

  app.log.info(`Scelta API listening on ${env.host}:${env.port}`);
}

async function openDatabase() {
  if (env.databaseMode === "pglite") {
    if (env.nodeEnv === "production") {
      throw new Error("SCELTA_DB=pglite is not available in production");
    }
    return createPgliteDatabase();
  }

  if (!env.databaseUrl) {
    if (env.nodeEnv === "production") {
      throw new Error("DATABASE_URL is required in production");
    }
    return undefined;
  }

  try {
    const database = createPostgresDatabase(env.databaseUrl);
    await database.ensureSchema();
    return database;
  } catch (error) {
    console.error(error);
    throw new Error(
      "Could not reach PostgreSQL. Start it with `docker compose up -d postgres`, or set SCELTA_DB=pglite to run without PostgreSQL.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
