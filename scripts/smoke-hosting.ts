#!/usr/bin/env bun
// Smoke test for the web app on Cloudflare (specs/platform-v2.md, PLAT-4: AC6, AC8, AC9).
//
//   bun scripts/smoke-hosting.ts <base-url> [--old <file>] [--expect key=value]…
//
// Fetches the deployed app and checks: the shell and a deep link are HTML with the edge config
// injected and revalidate; /config.json answers; a hashed file is immutable; a missing /static/*
// file is a 404, not the shell; the push service workers are JS, at the root, revalidated; and
// the security headers are on every response. `--old` names a file listing /static/* paths of
// an earlier build (written by scripts/hosting/retain-static.sh): a sample must still be served.
// `--expect supabaseUrl=https://…` checks a value in /config.json.
// Prints a Markdown table (CI appends it to the job summary) and exits 1 on any failure.

import { readFileSync } from "node:fs";

export type Check = { name: string; ok: boolean; detail: string };
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const SECURITY = [
  ["x-content-type-options", /^nosniff$/],
  ["content-security-policy", /frame-ancestors 'none'/],
  ["content-security-policy-report-only", /default-src 'self'/],
  ["referrer-policy", /\S/],
  ["permissions-policy", /\S/],
] as const;

function securityProblems(res: Response): string[] {
  return SECURITY.filter(([h, re]) => !re.test(res.headers.get(h) ?? "")).map(
    ([h]) => `missing ${h}`,
  );
}

function check(name: string, problems: string[], ok: string): Check {
  return { name, ok: problems.length === 0, detail: problems.length ? problems.join("; ") : ok };
}

/** Every check against one deployed origin. Pure apart from `fetchFn`, for tests. */
export async function smoke(
  base: string,
  opts: { old?: string[]; expect?: Record<string, string>; fetchFn?: Fetch } = {},
): Promise<Check[]> {
  const f: Fetch = opts.fetchFn ?? ((url, init) => fetch(url, { redirect: "manual", ...init }));
  const root = base.replace(/\/+$/, "");
  const checks: Check[] = [];
  let shellHtml = "";

  for (const path of ["/", "/tasks?id=MOD-1"]) {
    const res = await f(`${root}${path}`);
    const html = await res.text();
    if (path === "/") shellHtml = html;
    const p: string[] = [];
    if (res.status !== 200) p.push(`status ${res.status}`);
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) p.push("not HTML");
    if (!/<script>window\.__MODUO_CONFIG__=\{/.test(html)) p.push("no injected config");
    if (res.headers.get("cache-control") !== "no-cache")
      p.push(`cache-control ${res.headers.get("cache-control")}`);
    p.push(...securityProblems(res));
    checks.push(check(`GET ${path}`, p, "200 HTML, config injected, no-cache, security headers"));
  }

  {
    const res = await f(`${root}/config.json`);
    const p: string[] = [];
    let config: Record<string, unknown> = {};
    try {
      config = (await res.json()) as Record<string, unknown>;
    } catch {
      p.push("not JSON");
    }
    if (res.status !== 200) p.push(`status ${res.status}`);
    if (typeof config.supabaseUrl !== "string" || !config.supabaseUrl) p.push("no supabaseUrl");
    for (const [k, v] of Object.entries(opts.expect ?? {})) {
      if (config[k] !== v)
        p.push(`${k} is ${JSON.stringify(config[k])}, want ${JSON.stringify(v)}`);
    }
    checks.push(check("GET /config.json", p, `200 JSON (${Object.keys(config).join(", ")})`));
  }

  const hashed = shellHtml.match(/\/static\/js\/[^"']+\.js/)?.[0];
  {
    const p: string[] = [];
    if (!hashed) p.push("no /static/js file in the shell");
    else {
      const res = await f(`${root}${hashed}`);
      await res.arrayBuffer();
      if (res.status !== 200) p.push(`status ${res.status}`);
      if (!/immutable/.test(res.headers.get("cache-control") ?? ""))
        p.push(`cache-control ${res.headers.get("cache-control")}`);
      if (!(res.headers.get("content-type") ?? "").includes("javascript")) p.push("not JS");
      p.push(...securityProblems(res));
    }
    checks.push(check(`GET ${hashed ?? "/static/js/*"}`, p, "200 JS, immutable, security headers"));
  }

  {
    const res = await f(`${root}/static/js/async/smoke-missing.0000000000.js`);
    const body = await res.text();
    const p: string[] = [];
    if (res.status !== 404) p.push(`status ${res.status}`);
    if (/<html/i.test(body)) p.push("served the HTML shell");
    checks.push(check("GET missing /static/* file", p, "404, not the shell"));
  }

  for (const path of ["/push-sw.js", "/push-display.js"]) {
    const res = await f(`${root}${path}`);
    const body = await res.text();
    const p: string[] = [];
    if (res.status !== 200) p.push(`status ${res.status}`);
    if (/<html/i.test(body)) p.push("served the HTML shell");
    if (!(res.headers.get("content-type") ?? "").includes("javascript")) p.push("not JS");
    if (!/no-cache/.test(res.headers.get("cache-control") ?? ""))
      p.push(`cache-control ${res.headers.get("cache-control")}`);
    p.push(...securityProblems(res));
    checks.push(check(`GET ${path}`, p, "200 JS, no-cache"));
  }

  if (opts.old?.length) {
    const sample = opts.old.filter((x) => x.startsWith("/static/")).slice(0, 10);
    const p: string[] = [];
    for (const path of sample) {
      const res = await f(`${root}${path}`);
      await res.arrayBuffer();
      if (res.status !== 200) p.push(`${path} → ${res.status}`);
    }
    if (!sample.length) p.push("no /static paths in the list");
    checks.push(check(`previous build's files (${sample.length} sampled)`, p, "all 200"));
  }

  return checks;
}

export function table(base: string, checks: Check[]): string {
  const rows = checks.map(
    (c) => `| ${c.ok ? "✅" : "❌"} | ${c.name} | ${c.detail.replace(/\|/g, "\\|")} |`,
  );
  return [
    `**Hosting smoke · ${base}**`,
    "",
    "| | Check | Result |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let base = "";
  const old: string[] = [];
  const expect: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--old") {
      old.push(
        ...readFileSync(args[++i], "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      );
    } else if (args[i] === "--expect") {
      const [k, ...v] = args[++i].split("=");
      expect[k] = v.join("=");
    } else base = args[i];
  }
  if (!base) {
    console.error(
      "usage: bun scripts/smoke-hosting.ts <base-url> [--old <file>] [--expect key=value]…",
    );
    process.exit(2);
  }
  const checks = await smoke(base, { old, expect });
  console.log(table(base, checks));
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}
