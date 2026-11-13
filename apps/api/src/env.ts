import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(sourceDir, "../../../.env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const databaseMode = process.env.SCELTA_DB === "pglite" ? "pglite" : "postgres";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  host: required("API_HOST", "0.0.0.0"),
  port: Number(required("API_PORT", "3333")),
  corsOrigin: required("CORS_ORIGIN", "http://localhost:5173"),
  databaseUrl: databaseMode === "pglite" ? undefined : process.env.DATABASE_URL,
  databaseMode,
  adminEmail: optional("ADMIN_EMAIL"),
  adminPassword: optional("ADMIN_PASSWORD"),
  adminName: optional("ADMIN_NAME") ?? "Administrador",
  churchName: process.env.CHURCH_NAME ?? "Igreja local",
  nodeEnv: required("NODE_ENV", "development"),
};
