import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverUrl = process.env.SERVER_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": serverUrl,
      "/collab": { target: serverUrl, ws: true },
    },
  },
});
