import { defineConfig } from "@rstest/core";

export default defineConfig({
  testEnvironment: "node",
  include: ["edge/**/*.test.ts", "*.test.ts"],
  // CI shards every suite three ways; this one has two files, so a shard can be empty.
  passWithNoTests: true,
});
