import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { healthRoutes } from "./routes/health.js";
import { rulesRoutes } from "./routes/rules.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: true,
  });
  await app.register(sensible);
  await app.register(healthRoutes);
  await app.register(rulesRoutes);

  return app;
}
