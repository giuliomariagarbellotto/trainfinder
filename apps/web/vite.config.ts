import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = process.env.BACKEND_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  build: {
    // MapLibre da solo supera i 500 kB: lo teniamo in un file separato, cacheabile a lungo.
    rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"] } } },
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": backend,
      "/ws": { target: backend.replace(/^http/, "ws"), ws: true },
    },
  },
});
