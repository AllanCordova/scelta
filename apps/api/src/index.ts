import { createPgliteDatabase, createPostgresDatabase } from "@scelta/db";
import { assertAdminAccountConfig } from "./auth/admin-account.js";
import { env } from "./env.js";
import { buildApp } from "./app.js";
import { attachRealtime } from "./realtime.js";
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

  const app = await buildApp({ roomRepository, userRepository });

  await app.listen({
    host: env.host,
    port: env.port,
  });

  const rawServer = app.server;
  attachRealtime(rawServer, env.corsOrigin);

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
