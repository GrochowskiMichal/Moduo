import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";

// Scoped Storybook config used ONLY as the design-sync fidelity reference.
// It globs only the design-system core stories (src/components/ui/* and the
// shared chrome components directly under src/components/*), excluding the
// app-feature stories (dashboard widgets, mindmap, notes, email, app shell)
// which pull live data / Tauri / Yjs / XYFlow and aren't part of the synced DS.
const projectRoot = path.resolve(process.cwd());

const config: StorybookConfig = {
  stories: [
    "../../src/components/ui/*.stories.@(js|jsx|ts|tsx)",
    "../../src/components/*.stories.@(js|jsx|ts|tsx)",
  ],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    const existingAlias = cfg.resolve.alias;
    // tsconfig maps `@/*` -> `./src/*`; mirror that here so `@/lib/utils` and
    // `@/components/...` resolve correctly in the reference build.
    const aliasMap: Record<string, string> = {
      "moduo2.0": path.resolve(projectRoot, ".design-sync/entry.tsx"),
      "@contracts": path.resolve(projectRoot, "supabase/functions/_shared/contracts"),
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
