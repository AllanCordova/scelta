import { apiUrl } from "./api-url";

export type PublicConfig = {
  publicUrl: string | null;
};

function stripTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Fetches public runtime configuration from GET /v1/config.
 */
export async function fetchPublicConfig(): Promise<PublicConfig> {
  const response = await fetch(apiUrl("/v1/config"), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`config_fetch_failed_${response.status}`);
  }

  const body = (await response.json()) as { publicUrl?: unknown };
  const raw = typeof body.publicUrl === "string" ? stripTrailingSlashes(body.publicUrl) : "";
  return {
    publicUrl: raw.length > 0 ? raw : null,
  };
}

/**
 * Returns normalized publicUrl when configured, otherwise normalized currentOrigin.
 */
export function resolvePublicOrigin(publicUrl: string | null, currentOrigin: string): string {
  const normalizedPublic = publicUrl ? stripTrailingSlashes(publicUrl) : "";
  if (normalizedPublic.length > 0) {
    return normalizedPublic;
  }
  return stripTrailingSlashes(currentOrigin);
}

/**
 * Returns true when publicUrl is set and its URL origin differs from currentOrigin.
 */
export function hasOriginMismatch(publicUrl: string | null, currentOrigin: string): boolean {
  const normalizedPublic = publicUrl ? stripTrailingSlashes(publicUrl) : "";
  if (normalizedPublic.length === 0) {
    return false;
  }

  const publicOrigin = parseOrigin(normalizedPublic);
  const browserOrigin = parseOrigin(stripTrailingSlashes(currentOrigin));
  if (publicOrigin && browserOrigin) {
    return publicOrigin !== browserOrigin;
  }

  return normalizedPublic !== stripTrailingSlashes(currentOrigin);
}
