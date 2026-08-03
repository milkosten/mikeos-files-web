import { defineConfig } from "vite";

// Static SPA build. Output goes to dist/, served by server.js in the Docker
// container on the 242 host (fronted by shared Caddy). No external CDNs —
// everything is bundled/inlined.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100000,
  },
  // Local dev convenience: proxy the same-origin endpoints to a running server.js.
  server: {
    proxy: {
      "/auth": "http://localhost:8075",
      "/drive-api": "http://localhost:8075",
    },
  },
});
