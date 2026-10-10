import { fileURLToPath } from "node:url";

import { pluginReact } from "@rsbuild/plugin-react";
import { defineConfig } from "@rstest/core";

export default defineConfig({
  // The app compiles JSX with the automatic runtime (`react-jsx`). Without
  // this plugin, a rendered test throws "React is not defined".
  plugins: [pluginReact()],
  // Mirrors the `@/*` path alias from tsconfig.json — without it, any component
  // that imports `@/lib/utils` (i.e. every shadcn-wrapped primitive) is
  // untestable, which is why the ui/ primitives had no render tests before.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@contracts": fileURLToPath(
        new URL("./supabase/functions/_shared/contracts", import.meta.url),
      ),
      "@email": fileURLToPath(new URL("./supabase/functions/_shared/email", import.meta.url)),
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
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "supabase/functions/_shared/contracts/**/*.test.ts",
    "supabase/functions/_shared/*.test.ts",
    // The MCP connector's own tests mock its esm.sh imports (Deno-only).
    "supabase/functions/moduo-mcp/**/*.test.ts",
    "supabase/functions/_shared/email/**/*.test.ts",
    "supabase/functions/send-workspace-invite/*.test.ts",
    "supabase/functions/auth-email-hook/*.test.ts",
    "supabase/functions/email-worker/*.test.ts",
    "supabase/functions/booking-public/*.test.ts",
    "scripts/brand/*.test.ts",
  ],
  globals: true,
  setupFiles: ["./rstest.setup.ts"],
  // One file at a time, same as the old `vitest --maxWorkers=1`.
  pool: { maxWorkers: 1 },
  performance: { buildCache: true },
});
