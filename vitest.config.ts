import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    dedupe: ["@modelcontextprotocol/server"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
