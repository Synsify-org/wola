import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Component/unit tests only (jsdom, no real browser, no DB). Server actions
// that talk to Postgres are covered the other way — packages/db/test/*.test.mjs
// against a real database, same pattern as the rest of the monorepo.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    css: false,
  },
});
