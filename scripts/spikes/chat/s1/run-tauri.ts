// CV-0 spike 1: run the harness inside the Tauri desktop shell (macOS:
// WKWebView, the system WebKit), against the harness dev server, and close
// the app once the collector has every library's results.
//   bun scripts/spikes/chat/s1/run-tauri.ts <devPort> <collectPort> [libs] [extra query]
// The app runs under its own identifier (com.moduo.spike-s1), so it never
// opens the installed app's data; S1_CARGO_TARGET_DIR reuses a cargo target.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const devPort = Number(process.argv[2] ?? 8391);
const collectPort = Number(process.argv[3] ?? 8392);
const libs = (process.argv[4] ?? "tanstack").split(",");
const extra = process.argv[5] ?? "";
const engine = process.env.S1_ENGINE ?? "wkwebview";
const identifier = "com.moduo.spike-s1";

const collect = `http://127.0.0.1:${collectPort}/`;
const devUrl = `http://127.0.0.1:${devPort}/?auto=1&engine=${engine}&libs=${libs.join(",")}&collect=${encodeURIComponent(collect)}${extra ? `&${extra}` : ""}`;
// WebKit draws no frames for a window that isn't on screen (requestAnimationFrame
// stops), so the window stays on top and on every Space while it measures.
const config = {
  identifier,
  build: { devUrl },
  app: {
    windows: [
      {
        title: "Moduo · CV-0 spike 1 (closes itself)",
        dragDropEnabled: false,
        width: 1280,
        height: 840,
        center: true,
        focus: true,
        alwaysOnTop: true,
        visibleOnAllWorkspaces: true,
        backgroundThrottling: "disabled",
      },
    ],
  },
};
console.log(`[tauri] ${devUrl}`);

const child = spawn(
  "node",
  [
    "./node_modules/@tauri-apps/cli/tauri.js",
    "dev",
    "--no-watch",
    "--config",
    JSON.stringify(config),
  ],
  {
    env: {
      ...process.env,
      MODUO_TARGET: "desktop",
      ...(process.env.S1_CARGO_TARGET_DIR
        ? { CARGO_TARGET_DIR: process.env.S1_CARGO_TARGET_DIR }
        : {}),
    },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  },
);

const deadline = Date.now() + 40 * 60_000;
let done = false;
while (!done && Date.now() < deadline && child.exitCode === null) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const status = (await (await fetch(`${collect}status`)).json()) as Record<string, string[]>;
    done = libs.every((l) => status[engine]?.includes(l));
  } catch {
    // collector not up yet
  }
}
console.log(
  done ? "[tauri] all results in; closing the app" : "[tauri] gave up waiting; closing the app",
);
// The CLI, cargo and the app share a process group (detached above).
if (child.pid && child.exitCode === null) {
  try {
    process.kill(-child.pid, "SIGINT");
  } catch {
    // already gone
  }
  await new Promise((r) => setTimeout(r, 3000));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // already gone
  }
}
// The spike app's own data (never the installed app's).
for (const base of ["Application Support", "Caches", "WebKit"]) {
  rmSync(join(homedir(), "Library", base, identifier), { recursive: true, force: true });
}
process.exit(done ? 0 : 1);
