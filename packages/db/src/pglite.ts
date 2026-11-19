import type { Db } from "./client.js";
import { runMigrations } from "./migrate.js";
import * as schema from "./schema.js";

export async function createPgliteDatabase(): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await runMigrations(db);

  return {
    db: db as unknown as Db,
    close: () => client.close(),
  };
}
