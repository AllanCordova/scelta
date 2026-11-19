import { type Db } from "@scelta/db";
import { sql } from "drizzle-orm";

/**
 * Truncates `audit_events` for test isolation without triggering the
 * row-level `BEFORE UPDATE OR DELETE` immutability trigger.
 */
export async function clearAuditEvents(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE audit_events`);
}
