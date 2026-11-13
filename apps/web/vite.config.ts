import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:3333";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/v1": proxyTarget,
      "/health": proxyTarget,
    },
  },
});
