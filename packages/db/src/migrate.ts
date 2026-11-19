import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgresJs } from "drizzle-orm/postgres-js/migrator";

function resolveDefaultMigrationsFolder(): string {
  const metaUrl = (import.meta as { url?: string }).url ?? "";
  const withoutProtocol = decodeURIComponent(metaUrl.replace(/^file:\/\/\/?/, ""));
  const normalized = /^\/[A-Za-z]:\//.test(`/${withoutProtocol}`)
    ? withoutProtocol
    : `/${withoutProtocol}`;
  const lastSlash = normalized.lastIndexOf("/");
  const currentDir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : ".";
  const parentSlash = currentDir.lastIndexOf("/");
  const packageRoot = parentSlash >= 0 ? currentDir.slice(0, parentSlash) : currentDir;
  return `${packageRoot}/drizzle`;
}

export const MIGRATIONS_FOLDER = resolveDefaultMigrationsFolder();

export async function runMigrations(
  db: unknown,
  options?: { migrationsFolder?: string },
): Promise<void> {
  const migrationsFolder = options?.migrationsFolder ?? MIGRATIONS_FOLDER;
  const candidate = db as { $client?: unknown; session?: { client?: unknown } };
  const rawClient = candidate?.$client ?? candidate?.session?.client;

  if (rawClient && typeof (rawClient as { exec?: unknown }).exec === "function") {
    await migratePglite(db as Parameters<typeof migratePglite>[0], { migrationsFolder });
    return;
  }

  await migratePostgresJs(db as Parameters<typeof migratePostgresJs>[0], { migrationsFolder });
}
