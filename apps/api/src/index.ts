import { env } from "./env.js";
import { buildApp } from "./app.js";
import { attachRealtime } from "./realtime.js";

async function main() {
  const app = await buildApp();

  await app.listen({
    host: env.host,
    port: env.port,
  });

  const rawServer = app.server;
  attachRealtime(rawServer, env.corsOrigin);

  app.log.info(`Scelta API listening on ${env.host}:${env.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
