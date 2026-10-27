#!/usr/bin/env node
// `srt` for the A/B rig: the same sandbox, plus the shared local Supabase stack's ports closed.
//
//   scripts/harness-ab/srt-offline.mjs --settings <profile.json> -c "<command>"
//
// Tests need allowLocalBinding (rstest probes a port before it runs), and srt's macOS profile then
// allows every outbound connection to localhost, the stack's Postgres on 54322 included. srt takes
// no extra rules and macOS can't nest sandboxes, so this builds the sandbox with srt's own library
// and adds a deny per stack port right after that allow (a `remote tcp` deny wins over the `remote
// ip` allow; checked live with srt 0.0.81, 2026-10-26). It fails closed: no anchor, no run.
// Only macOS is supported, like the frozen-tests globs (docs/gotchas/workflow.md).

import { execFileSync, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The shared stack's ports, 54320 (the shadow DB) through 54329. */
export const STACK_PORTS = Array.from({ length: 10 }, (_, i) => 54320 + i);
export const ANCHOR = '(allow network-outbound (remote ip "localhost:*"))';

/** The sandbox profile inside srt's wrapped command, with the stack ports denied after the anchor. */
export function closeStackPorts(wrapped) {
  if (!wrapped.includes(ANCHOR))
    throw new Error("srt-offline: srt's localhost rule wasn't found; refusing to run unpatched");
  const deny = STACK_PORTS.map((p) => `(deny network-outbound (remote tcp "localhost:${p}"))`);
  return wrapped.replace(ANCHOR, [ANCHOR, ...deny].join("\n"));
}

async function main(argv) {
  const at = (flag) => argv[argv.indexOf(flag) + 1];
  if (!argv.includes("--settings") || !argv.includes("-c")) {
    console.error('usage: srt-offline.mjs --settings <profile.json> -c "<command>"');
    return 64;
  }
  if (process.platform !== "darwin") {
    console.error("srt-offline: macOS only (the stack-port rules are Seatbelt rules)");
    return 1;
  }
  const cli = realpathSync(
    execFileSync("sh", ["-c", "command -v srt"], { encoding: "utf8" }).trim(),
  );
  const dist = path.dirname(cli);
  const { SandboxManager } = await import(path.join(dist, "index.js"));
  const { loadConfig } = await import(path.join(dist, "utils/config-loader.js"));
  const loaded = loadConfig(at("--settings"));
  if (loaded.kind !== "ok") throw new Error(`srt-offline: can't load ${at("--settings")}`);
  if (!loaded.config.network?.allowLocalBinding)
    // Without local binding srt already blocks every localhost port; nothing to add.
    console.error("srt-offline: allowLocalBinding is off, localhost is closed entirely");
  await SandboxManager.initialize(loaded.config);
  let wrapped = await SandboxManager.wrapWithSandbox(at("-c"));
  if (loaded.config.network?.allowLocalBinding) wrapped = closeStackPorts(wrapped);
  const child = spawn(wrapped, { shell: true, stdio: "inherit" });
  const code = await new Promise((resolve) => {
    child.on("exit", (c, signal) => resolve(signal ? 1 : (c ?? 0)));
    child.on("error", () => resolve(1));
  });
  SandboxManager.cleanupAfterCommand?.();
  await SandboxManager.reset();
  return code;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
