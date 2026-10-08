import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";

const projectRoot = path.resolve(process.cwd());

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-mcp"],

  framework: {
    name: "@storybook/react-vite",
    options: {},
  },

  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    const existingAlias = cfg.resolve.alias;
    // Mirror tsconfig `paths` exactly (`@/*` → src, `@contracts/*` → the shared
    // Zod layer, `@email/*` → the email kit). `@` used to point at the repo root, so every `@/lib/utils`
    // import 404'd and no story rendered (gotchas §Storybook).
    const aliasMap: Record<string, string> = {
      "@contracts": path.resolve(projectRoot, "supabase/functions/_shared/contracts"),
      "@email": path.resolve(projectRoot, "supabase/functions/_shared/email"),
      "@/src": path.resolve(projectRoot, "src"),
      "@": path.resolve(projectRoot, "src"),
    };
    if (Array.isArray(existingAlias)) {
      cfg.resolve.alias = [
        ...existingAlias,
        ...Object.entries(aliasMap).map(([find, replacement]) => ({ find, replacement })),
      ];
    } else {
      cfg.resolve.alias = { ...(existingAlias ?? {}), ...aliasMap };
    }
    return cfg;
  },
};

export default config;
