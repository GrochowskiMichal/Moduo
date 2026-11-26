#!/usr/bin/env bun
// Let an agent see the app it is changing, signed in, on the LOCAL stack only.
//
//   bun run agent:login              make (or keep) the agent's own person,
//                                    agent@moduo.local, with a little demo data,
//                                    and save its session to .auth/agent.json
//   bun run agent:look <route> [...] open each route signed in, save a
//                                    full-page screenshot per route, print the
//                                    console errors and failed requests
//
// look options: --url <base> (default: this worktree's own dev port, started
// here when nothing listens and stopped after), --out <dir> (default
// .auth/shots), --width/--height (default 1440x900), --wait <ms> (extra settle
// time, default 1500).
//
// The agent has its own person and workspace, so it never reads anyone's
// data (AGENTS.md rule 10). The password is local-only: stackKeys refuses
// anything but 127.0.0.1. Never point this at the cloud.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, chromium, type Page } from "@playwright/test";

import {
  markWelcomeSeen,
  rest,
  type Session,
  setLocalPassword,
  signIn,
  stackKeys,
} from "../../e2e/tests/support/local-stack";
import { e2eAppUrl, e2eRoot } from "./e2e-env";

export const AGENT = { email: "agent@moduo.local", password: "localagent", name: "Agent" };
const AUTH_DIR = path.join(e2eRoot, ".auth");
const AUTH_FILE = path.join(AUTH_DIR, "agent.json");

type Saved = { session: Session; workspaceId: string };

async function ensureAgent(): Promise<string> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === AGENT.email);
  if (!user) {
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: AGENT.email,
        email_confirm: true,
        user_metadata: { full_name: AGENT.name, display_name: AGENT.name },
      }),
    });
    if (!res.ok)
      throw new Error(`creating ${AGENT.email} failed: ${res.status} ${await res.text()}`);
    user = (await res.json()) as { id: string; email: string };
  }
  // Auth refuses password writes; set it in SQL (supabase/seed.sql does the same).
  setLocalPassword(user.id, AGENT.password);
  return user.id;
}

/** A project with a few tasks, once, so pages have something to draw. */
async function ensureDemo(me: Session, ws: { id: string }): Promise<void> {
  const name = "Agent demo";
  const have = await rest<unknown[]>(
    me,
    `buckets?workspace_id=eq.${ws.id}&name=eq.${encodeURIComponent(name)}&deleted_at=is.null&select=id`,
  );
  if (have.length > 0) return;
  const [project] = await rest<Array<{ id: string }>>(me, "buckets", {
    method: "POST",
    body: { workspace_id: ws.id, owner_id: me.user.id, name, position: "a0" },
  });
  const tasks: Array<[string, string, string]> = [
    ["Draft the launch checklist", "todo", project.id],
    ["Review onboarding copy", "in_progress", project.id],
    ["Ship the pricing page", "done", project.id],
    ["Call the accountant", "todo", project.id],
  ];
  for (const [i, [title, status, bucket]] of tasks.entries()) {
    await rest(me, "tasks", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        id: crypto.randomUUID(),
        workspace_id: ws.id,
        bucket_id: bucket,
        title,
        status,
        owner_id: me.user.id,
        position: `a${i}`,
      },
    }).catch((e: Error) => console.warn(`demo task "${title}" skipped: ${e.message}`));
  }
}

export async function login(): Promise<Saved> {
  const id = await ensureAgent();
  const session = await signIn(AGENT);
  const owned = await rest<unknown[]>("service", `workspaces?owner_id=eq.${id}&select=id`);
  // A new person has no workspace until the app's onboarding makes one; make it as they would.
  if (owned.length === 0) {
    await rest(session, "workspaces", { method: "POST", body: { name: "Agent", owner_id: id } });
  }
  const [ws] = await rest<Array<{ id: string }>>(
    "service",
    `workspaces?owner_id=eq.${id}&select=id&order=created_at.asc&limit=1`,
  );
  await markWelcomeSeen(id);
  await ensureDemo(session, ws);
  const saved: Saved = { session, workspaceId: ws.id };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(saved, null, 2));
  return saved;
}

/** The saved session, signed in again when it is near expiry or missing. */
async function current(): Promise<Saved> {
  if (existsSync(AUTH_FILE)) {
    const saved = JSON.parse(readFileSync(AUTH_FILE, "utf8")) as Saved;
    if ((saved.session.expires_at ?? 0) - 120 > Date.now() / 1000) return saved;
  }
  return login();
}

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

/** This worktree's dev server, started when nothing answers at `base`; returns how to stop it. */
async function ensureServer(base: string, explicit: boolean): Promise<() => void> {
  if (await up(base)) return () => {};
  if (explicit) throw new Error(`nothing answers at ${base}`);
  const port = new URL(base).port;
  console.log(`look: starting the dev server on ${port}...`);
  const server = Bun.spawn(
    [path.join(e2eRoot, "node_modules/.bin/rsbuild"), "dev", "--host", "127.0.0.1", "--port", port],
    {
      cwd: path.join(e2eRoot, "apps/app"),
      env: { ...process.env, MODUO_TARGET: "web" },
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  const until = Date.now() + 120_000;
  while (!(await up(base))) {
    if (Date.now() > until) {
      server.kill();
      throw new Error("the dev server didn't come up in 120 s");
    }
    await Bun.sleep(500);
  }
  return () => server.kill();
}

/** Console errors, page errors and failed requests, minus the dev server's devtools pipe. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  const push = (line: string) => {
    if (!line.includes("/__tsd/")) problems.push(line);
  };
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 404/.test(m.text())) push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => push(`failed: ${r.method()} ${r.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 400) push(`${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return problems;
}

async function signedInPage(
  browser: Browser,
  saved: Saved,
  opts: Record<string, string>,
): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: Number(opts.width ?? 1440), height: Number(opts.height ?? 900) },
  });
  const host = new URL(stackKeys().url).hostname.split(".")[0];
  const { session: s, workspaceId } = saved;
  const pairs: Array<[string, string]> = [
    [`sb-${host}-auth-token`, JSON.stringify(s)],
    [`moduo:selected-workspace:${s.user.id}`, workspaceId],
  ];
  await page.addInitScript((kv) => {
    for (const [k, v] of kv) window.localStorage.setItem(k, v);
  }, pairs);
  return page;
}

async function look(routes: string[], opts: Record<string, string>): Promise<void> {
  const saved = await current();
  const base = opts.url ?? e2eAppUrl;
  const stop = await ensureServer(base, Boolean(opts.url));
  const out = opts.out ?? path.join(AUTH_DIR, "shots");
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await signedInPage(browser, saved, opts);
    const problems = watchProblems(page);
    for (const route of routes.length ? routes : ["/"]) {
      problems.length = 0;
      await page
        .goto(new URL(route, base).toString(), { waitUntil: "networkidle" })
        .catch(() => {});
      await page.waitForTimeout(Number(opts.wait ?? 1500));
      const name = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
      const file = path.join(out, `${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const lost = page.url().includes("/login") ? "  (landed on login)" : "";
      console.log(`look: ${route} -> ${file}${lost}`);
      for (const p of problems) console.log(`  ${p}`);
    }
  } finally {
    await browser.close();
    stop();
  }
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const opts: Record<string, string> = {};
  const routes: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) opts[args[i].slice(2)] = args[++i];
    else routes.push(args[i]);
  }
  if (cmd === "login") {
    const s = await login();
    console.log(`login: ${AGENT.email} in workspace ${s.workspaceId}, session in ${AUTH_FILE}`);
  } else if (cmd === "look") {
    await look(routes, opts);
  } else {
    console.error(
      "usage: bun scripts/agent/look.ts login | look <route>... [--url --out --width --height --wait]",
    );
    process.exit(2);
  }
}
