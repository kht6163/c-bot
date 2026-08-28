import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.CBOT_PORT ?? "3080");
const apiOrigin = `http://127.0.0.1:${Number.isInteger(apiPort) && apiPort > 0 ? apiPort : 3080}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    hmr: {
      host: "127.0.0.1",
      port: 5173,
      clientPort: 5173,
    },
    proxy: {
      "/api": { target: apiOrigin, changeOrigin: true },
      "/ws": { target: apiOrigin, ws: true, changeOrigin: true },
    },
    fs: {
      allow: ["../.."],
    },
  },
});
