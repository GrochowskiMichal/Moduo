import { defineConfig } from "@rstest/core";

// Tests for the repo tooling in scripts/ (`bun run test:scripts`, part of verify).
export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  include: ["scripts/brand/*.test.ts", "scripts/release/*.test.ts"],
  globals: true,
});
