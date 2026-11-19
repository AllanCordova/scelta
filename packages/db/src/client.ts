import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { runMigrations } from "./migrate.js";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

export function createPostgresDatabase(connectionString: string) {
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  return {
    db,
    migrate() {
      return runMigrations(db);
    },
    ensureSchema() {
      return runMigrations(db);
    },
    close() {
      return client.end({ timeout: 5 });
    },
  };
}
