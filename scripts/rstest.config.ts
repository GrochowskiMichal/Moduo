import { defineConfig } from "@rstest/core";

// Tests for the repo tooling in scripts/ (`bun run test:scripts`, part of verify).
export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  include: [
    "scripts/brand/*.test.ts",
    "scripts/release/*.test.ts",
    "scripts/smoke-hosting.test.ts",
    "scripts/dns-diff.test.ts",
    "scripts/db-types.test.ts",
  ],
  globals: true,
  // CI shards every suite three ways (checks.yml); this one has few files, so a shard can be empty.
  passWithNoTests: true,
});
