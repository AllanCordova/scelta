import type { FastifyPluginAsync } from "fastify";
import { env, normalizePublicUrl } from "../env.js";

export type ConfigRouteOptions = {
  publicUrl?: string | null;
};

/**
 * Registers public runtime configuration endpoints.
 */
export const configRoutes: FastifyPluginAsync<ConfigRouteOptions> = async (app, options) => {
  const publicUrl =
    options.publicUrl !== undefined ? normalizePublicUrl(options.publicUrl) : env.publicUrl;

  app.get("/v1/config", async () => {
    return {
      publicUrl,
    };
  });
};
