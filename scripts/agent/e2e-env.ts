// Where this worktree's e2e dev server listens, and which Playwright projects
// a run asked for. Read by playwright.config.ts (so it is the same in the runner
// and in every worker) and by scripts/agent/e2e.sh (which prints it).
//
// Every worktree gets its own port, derived from its real path, so a run in
// worktree A never tests whatever dev server happens to be on 8081 (often
// worktree B's code). The range keeps clear of 8081, Storybook's 6006, the local
// Supabase stack (54321-54329) and the 81xx ports older spec headers name.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOW = 8200;
const SPAN = 800; // 8200-8999

export const e2eRoot = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);

export function e2ePortFor(root: string): number {
  const digest = createHash("sha1").update(root).digest();
  return LOW + (digest.readUInt32BE(0) % SPAN);
}

function resolvePort(): number {
  const forced = process.env.E2E_PORT;
  if (!forced) return e2ePortFor(e2eRoot);
  const n = Number(forced);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error(`E2E_PORT must be a port between 1024 and 65535, got "${forced}"`);
  }
  return n;
}

/** This worktree's own dev-server port (`E2E_PORT` overrides it). */
export const e2ePort = resolvePort();
export const e2eAppUrl = `http://127.0.0.1:${e2ePort}`;

/**
 * Whether a `playwright test` run will include `name`: true when no `--project`
 * was given (Playwright then runs every project), else only when it was named.
 * Playwright starts every `webServer` entry whatever the projects, so the config
 * uses this to leave Storybook alone for an e2e-only run.
 */
export function runsProject(name: string, argv: string[] = process.argv): boolean {
  const named: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--project=")) named.push(arg.slice("--project=".length));
    else if (arg === "--project") {
      for (let j = i + 1; j < argv.length && !argv[j].startsWith("-"); j++) named.push(argv[j]);
    }
  }
  return named.length === 0 || named.includes(name);
}

if (import.meta.main) {
  console.log(`${e2eAppUrl} (worktree ${e2eRoot})`);
}
