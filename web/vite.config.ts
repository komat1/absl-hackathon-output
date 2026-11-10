import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // The API is a separate process; proxying keeps the browser on one origin,
    // so no CORS preflight sits in front of the chat stream.
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } }
  }
});
