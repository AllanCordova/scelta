import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.feature.test.ts"],
    hookTimeout: 30_000,
    maxConcurrency: 4,
  },
});
