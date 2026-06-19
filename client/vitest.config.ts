import { defineConfig } from "vitest/config";

// Unit tests for pure logic. Kept separate from the Playwright E2E suite by
// file convention: vitest runs `src/**/*.test.ts`, Playwright runs `e2e/*.spec.ts`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
