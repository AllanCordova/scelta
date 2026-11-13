import { churches, type Db } from "@scelta/db";
import { eq } from "drizzle-orm";

export async function getOrCreateChurch(db: Db, churchName: string): Promise<string> {
  const existing = await findChurchByName(db, churchName);
  if (existing) {
    return existing.id;
  }

  try {
    const inserted = await db.insert(churches).values({ name: churchName }).returning();
    const church = inserted[0];
    if (!church) {
      throw new Error("Church insert returned no row");
    }
    return church.id;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const raced = await findChurchByName(db, churchName);
    if (!raced) {
      throw error;
    }
    return raced.id;
  }
}

export async function findChurchByName(db: Db, churchName: string) {
  const rows = await db.select().from(churches).where(eq(churches.name, churchName)).limit(1);
  return rows[0];
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  if ("code" in error && error.code === "23505") {
    return true;
  }

  if ("cause" in error) {
    return isUniqueViolation(error.cause);
  }

  return false;
}
