// Spike: the app's own Rsbuild config (React Compiler on, same aliases and
// defines) with the spike harness as the entry. Nothing in apps/app/src
// mounts it. Run from the repo root:
//   MODUO_TARGET=web ./node_modules/.bin/rsbuild dev \
//     --config scripts/spikes/tanstack-db/rsbuild.config.ts --host 127.0.0.1 --port 8395

import path from "node:path";
import { defineConfig, mergeRsbuildConfig } from "@rsbuild/core";
import base from "../../../apps/app/rsbuild.config";

const root = path.resolve(__dirname, "../../..");
const spike = (p: string) => path.resolve(__dirname, p);

export default mergeRsbuildConfig(
  base,
  defineConfig({
    source: { entry: { index: spike("harness/main.tsx") } },
    html: { template: spike("harness/index.html") },
    resolve: {
      // One React: the app's copy, not the peer bun put in the spike folder.
      alias: {
        react: path.join(root, "node_modules/react"),
        "react-dom": path.join(root, "node_modules/react-dom"),
      },
    },
    performance: { buildCache: false, prefetch: undefined },
    output: { distPath: { root: path.join(root, "dist/spike-tanstack-db") } },
  }),
);
