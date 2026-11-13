import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { SCHEMA_SQL } from "./schema-sql.js";

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
    ensureSchema() {
      return client.unsafe(SCHEMA_SQL);
    },
    close() {
      return client.end({ timeout: 5 });
    },
  };
}
