// The MCP eval's own Supabase stack (HV-29): a copy of `supabase/` under its own project id and
// ports, started with the Supabase CLI, built from the same schema snapshot as the shared stack
// (`stack.sh isolated`), and stopped and deleted afterwards. It never touches the shared stack
// (project "moduo", ports 54320-54329): every port is shifted by PORT_SHIFT and the project id
// differs, so `supabase stop` here only ever names this one.
//
//   bun scripts/harness-ab/mcp-eval/stack.ts up | status | down

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export const EVAL_PROJECT_ID = "moduo-mcp-eval";
/** 543xx → 553xx, 8083 → 8183: clear of the shared stack and of each other. */
export const PORT_SHIFT = 1000;
export const API_PORT = 54321 + PORT_SHIFT;
export const DB_PORT = 54322 + PORT_SHIFT;
export const DB_URL = `postgresql://supabase_admin:postgres@127.0.0.1:${DB_PORT}/postgres`;
export const MCP_URL = `http://127.0.0.1:${API_PORT}/functions/v1/moduo-mcp`;

const SOURCE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
/**
 * `up` makes a fresh private temp folder (`mkdtemp`: random name, mode 0700) and records its path
 * in one file per user, so `status` and `down` find it from any worktree or process.
 * MODUO_MCP_EVAL_WORKDIR overrides both.
 */
const POINTER = path.join(homedir(), ".cache", `${EVAL_PROJECT_ID}.workdir`);
const recorded = () =>
  process.env.MODUO_MCP_EVAL_WORKDIR ??
  (existsSync(POINTER) ? readFileSync(POINTER, "utf8").trim() || null : null);
/** Services the connector doesn't need (the same list stack.sh ci skips, minus what MCP uses). */
const EXCLUDE = "studio,imgproxy,logflare,vector,supavisor,mailpit,postgres-meta";

/** config.toml with the eval's project id and every shared-stack port moved out of the way. */
export function evalConfig(toml: string): string {
  const out = toml
    .replace(/^project_id\s*=\s*".*"$/m, `project_id = "${EVAL_PROJECT_ID}"`)
    .replace(
      /^(\s*\w*port\s*=\s*)(543\d\d)\b/gm,
      (_, k: string, p: string) => `${k}${Number(p) + PORT_SHIFT}`,
    )
    .replace(
      /^(inspector_port\s*=\s*)(\d+)/m,
      (_, k: string, p: string) => `${k}${Number(p) + 100}`,
    );
  if (!out.includes(`project_id = "${EVAL_PROJECT_ID}"`))
    throw new Error("mcp-eval: config.toml has no project_id line to rewrite");
  const left = out.match(/^\s*\w*port\s*=\s*5432\d\b/m);
  if (left)
    throw new Error(`mcp-eval: a shared-stack port survived the rewrite: ${left[0].trim()}`);
  return out;
}

const run = (cmd: string, args: string[], cwd = SOURCE) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

/** The workdir's config must be the eval's before any start or stop names it. */
function assertEvalWorkdir(workdir: string) {
  const config = path.join(workdir, "supabase/config.toml");
  const id =
    existsSync(config) && readFileSync(config, "utf8").match(/^project_id\s*=\s*"(.*)"$/m)?.[1];
  if (id !== EVAL_PROJECT_ID)
    throw new Error(`mcp-eval: ${config} is not the eval stack's (project_id ${id || "missing"})`);
}

export function up() {
  const old = recorded();
  // A stack left from an earlier `up` is stopped first (down checks its project id).
  if (old && existsSync(path.join(old, "supabase/config.toml"))) down();
  const override = process.env.MODUO_MCP_EVAL_WORKDIR;
  if (override) mkdirSync(override, { recursive: true });
  const workdir = override ?? mkdtempSync(path.join(tmpdir(), `${EVAL_PROJECT_ID}-`));
  cpSync(path.join(SOURCE, "supabase"), path.join(workdir, "supabase"), {
    recursive: true,
    filter: (src) => !/\/(\.temp|\.branches|tests|node_modules)(\/|$)|\/\.env$/.test(src),
  });
  const config = path.join(workdir, "supabase/config.toml");
  writeFileSync(config, evalConfig(readFileSync(config, "utf8")));
  assertEvalWorkdir(workdir);
  // Recorded once the workdir is the eval's, before anything starts, so `down` can always stop it.
  mkdirSync(path.dirname(POINTER), { recursive: true });
  writeFileSync(POINTER, `${workdir}\n`);
  console.error(`mcp-eval: starting ${EVAL_PROJECT_ID} on :${API_PORT} (db :${DB_PORT}) …`);
  const start = run("supabase", ["start", "--workdir", workdir, "-x", EXCLUDE]);
  if (start.status !== 0) throw new Error(`supabase start failed:\n${start.out}`);
  console.error("mcp-eval: bootstrapping the schema snapshot …");
  const boot = run("bash", ["scripts/local/stack.sh", "isolated", DB_URL]);
  if (boot.status !== 0) throw new Error(`stack.sh isolated failed:\n${boot.out.slice(-4000)}`);
  return status();
}

export function status(): { apiUrl: string; mcpUrl: string; dbUrl: string } {
  const workdir = recorded();
  if (!workdir) throw new Error("the eval stack isn't running (no workdir recorded; run up)");
  assertEvalWorkdir(workdir);
  const r = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  if (r.status !== 0) throw new Error(`the eval stack isn't running:\n${r.out}`);
  return { apiUrl: `http://127.0.0.1:${API_PORT}`, mcpUrl: MCP_URL, dbUrl: DB_URL };
}

export function down() {
  const workdir = recorded();
  if (!workdir || !existsSync(workdir)) {
    // Nothing recorded: stop the eval project by its id, which is never the shared stack's.
    const r = run("supabase", ["stop", "--project-id", EVAL_PROJECT_ID, "--no-backup"]);
    rmSync(POINTER, { force: true });
    if (r.status !== 0) throw new Error(`supabase stop failed:\n${r.out}`);
    return;
  }
  assertEvalWorkdir(workdir);
  // --no-backup drops this project's volumes only: the project id is the eval's, checked above.
  const r = run("supabase", ["stop", "--workdir", workdir, "--no-backup"]);
  if (r.status !== 0) throw new Error(`supabase stop failed:\n${r.out}`);
  rmSync(workdir, { recursive: true, force: true });
  rmSync(POINTER, { force: true });
}

if (import.meta.main) {
  const cmd = process.argv[2];
  try {
    if (cmd === "up") console.log(JSON.stringify(up(), null, 2));
    else if (cmd === "status") console.log(JSON.stringify(status(), null, 2));
    else if (cmd === "down") down();
    else {
      console.error("usage: bun scripts/harness-ab/mcp-eval/stack.ts up | status | down");
      process.exit(64);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
