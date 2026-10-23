import { defineConfig } from "@rstest/core";

export default defineConfig({
  testEnvironment: "node",
  include: ["src/**/*.test.ts"],
  // CI shards every suite three ways; this one has a single file, so two shards are empty.
  passWithNoTests: true,
});
