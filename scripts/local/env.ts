// Point .env.local at the local Supabase stack or back at the cloud project.
//   bun scripts/local/env.ts local | cloud | which
// Cloud values are parked in .env.cloud.local (gitignored by `.env*.local`)
// the first time you switch to local, and restored from there.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KEYS = [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "MODUO_SUPABASE_URL",
  "MODUO_SUPABASE_PUBLISHABLE_KEY",
] as const;
const ENV = ".env.local";
const PARKED = ".env.cloud.local";
const LOCAL_URL = "http://127.0.0.1:54321";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const get = (src: string, k: string) => src.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1];
function set(src: string, k: string, v: string) {
  const line = `${k}=${v}`;
  return new RegExp(`^${k}=.*$`, "m").test(src)
    ? src.replace(new RegExp(`^${k}=.*$`, "m"), line)
    : `${src.trimEnd()}\n${line}\n`;
}

const mode = process.argv[2] ?? "which";
let env = read(ENV);

if (mode === "which") {
  console.log(get(env, "PUBLIC_SUPABASE_URL")?.includes("127.0.0.1") ? "local" : "cloud");
} else if (mode === "local") {
  if (!get(env, "PUBLIC_SUPABASE_URL")?.includes("127.0.0.1")) {
    writeFileSync(PARKED, KEYS.map((k) => `${k}=${get(env, k) ?? ""}`).join("\n") + "\n");
  }
  const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
  const key: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  for (const k of KEYS) env = set(env, k, k.endsWith("_URL") ? LOCAL_URL : key);
  writeFileSync(ENV, env);
  console.log(`✓ .env.local → local stack (${LOCAL_URL}). Restart dev servers.`);
} else if (mode === "cloud") {
  const parked = read(PARKED);
  if (!parked) throw new Error(`${PARKED} not found; nothing to restore.`);
  for (const k of KEYS) env = set(env, k, get(parked, k) ?? "");
  writeFileSync(ENV, env);
  console.log("✓ .env.local → cloud project. Restart dev servers.");
} else {
  console.error("usage: env.ts local|cloud|which");
  process.exit(2);
}
