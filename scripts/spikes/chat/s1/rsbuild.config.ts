// CV-0 spike 1: the app's own Rsbuild config (React Compiler on, same
// aliases and defines), with the harness as the entry. Nothing in src/
// mounts the harness.
//   MODUO_TARGET=desktop ./node_modules/.bin/rsbuild dev \
//     --config scripts/spikes/chat/s1/rsbuild.config.ts --host 127.0.0.1 --port 8391

import { defineConfig, mergeRsbuildConfig } from "@rsbuild/core";
import base from "../../../../rsbuild.config";

export default mergeRsbuildConfig(
  base,
  defineConfig({
    source: { entry: { index: "./scripts/spikes/chat/s1/harness/main.tsx" } },
    html: { template: "./scripts/spikes/chat/s1/harness/index.html" },
    performance: { buildCache: false, prefetch: undefined },
    output: { distPath: { root: "dist/spike-s1" } },
  }),
);
