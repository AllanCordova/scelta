import * as schema from "./schema.js";
import { SCHEMA_SQL } from "./schema-sql.js";
import type { Db } from "./client.js";

export async function createPgliteDatabase(): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  await client.exec(SCHEMA_SQL);
  const db = drizzle(client, { schema });

  return {
    db: db as unknown as Db,
    close: () => client.close(),
  };
}