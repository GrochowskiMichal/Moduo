import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the `@/*` path alias from tsconfig.json — without it, any component
  // that imports `@/lib/utils` (i.e. every shadcn-wrapped primitive) is
  // untestable, which is why the ui/ primitives had no render tests before.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "supabase/functions/_shared/contracts/**/*.test.ts",
    ],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
