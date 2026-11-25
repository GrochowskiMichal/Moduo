import { defineConfig } from "@rstest/core";

export default defineConfig({
  testEnvironment: "node",
  include: ["src/**/*.test.ts"],
  // CI shards every suite three ways; this one is small, so a shard can be empty.
  passWithNoTests: true,
});
