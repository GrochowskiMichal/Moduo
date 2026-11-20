import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";

// The stories and static files live in the app package (apps/app).
const appRoot = fileURLToPath(new URL("../../app", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const config: StorybookConfig = {
  stories: ["../../app/src/**/*.mdx", "../../app/src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-mcp"],
  // Serves the app's public/ so stories can load real assets, such as the
  // email logos in public/email/.
  staticDirs: ["../../app/public"],

  framework: {
    name: "@storybook/react-vite",
    options: {},
  },

  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    const existingAlias = cfg.resolve.alias;
    // Mirror apps/app/tsconfig.json `paths` exactly (`@/*` → src, `@contracts/*` → the shared
    // Zod layer, `@email/*` → the email kit). `@` used to point at the repo root, so every `@/lib/utils`
    // import 404'd and no story rendered (gotchas §Storybook).
    const aliasMap: Record<string, string> = {
      "@contracts": path.resolve(repoRoot, "supabase/functions/_shared/contracts"),
      "@email": path.resolve(repoRoot, "supabase/functions/_shared/email"),
      "@/src": path.resolve(appRoot, "src"),
      "@": path.resolve(appRoot, "src"),
    };
    if (Array.isArray(existingAlias)) {
      cfg.resolve.alias = [
        ...existingAlias,
        ...Object.entries(aliasMap).map(([find, replacement]) => ({ find, replacement })),
      ];
    } else {
      cfg.resolve.alias = { ...existingAlias, ...aliasMap };
    }
    return cfg;
  },
};

export default config;
