import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";

const projectRoot = path.resolve(process.cwd());

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|ts|tsx)"],
  addons: ["@storybook/addon-essentials", "@storybook/addon-interactions"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve ?? {};
    const existingAlias = cfg.resolve.alias;
    const aliasMap: Record<string, string> = {
      "@/src": path.resolve(projectRoot, "src"),
      "@": projectRoot,
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
