import { fileURLToPath } from "node:url";

import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rstest/core";

// @moduo/backend: the Edge Function and contract tests. Some import app code
// (`@/types/supabase`, booking and notes helpers), so the app aliases resolve here too.
export default defineConfig({
  plugins: [pluginReact()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../apps/app/src", import.meta.url)),
      "@contracts": fileURLToPath(new URL("./functions/_shared/contracts", import.meta.url)),
      "@email": fileURLToPath(new URL("./functions/_shared/email", import.meta.url)),
    },
  },
  // Edge Functions import from esm.sh, which only Deno can load. Leave those
  // imports to run time, where a test that reaches one mocks it (rs.mock).
  output: {
    externals: [
      ({ request }, callback) =>
        request?.startsWith("https://esm.sh/")
          ? callback(undefined, `commonjs ${request}`)
          : callback(),
    ],
  },
  testEnvironment: "jsdom",
  include: [
    "functions/_shared/contracts/**/*.test.ts",
    "functions/_shared/*.test.ts",
    // The MCP connector's own tests mock its esm.sh imports (Deno-only).
    "functions/moduo-mcp/**/*.test.ts",
    "functions/_shared/email/**/*.test.ts",
    "functions/auth-email-hook/*.test.ts",
    "functions/email-worker/*.test.ts",
    "functions/booking-public/*.test.ts",
    "functions/push-send/*.test.ts",
  ],
  globals: true,
  pool: { maxWorkers: "50%" },
  performance: { buildCache: true },
});
