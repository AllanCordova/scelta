import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  host: required("API_HOST", "0.0.0.0"),
  port: Number(required("API_PORT", "3333")),
  corsOrigin: required("CORS_ORIGIN", "http://localhost:5173"),
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: required("NODE_ENV", "development"),
};
