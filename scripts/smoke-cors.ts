#!/usr/bin/env bun
// CORS smoke for the signed-in Edge Functions (MOD-75). Read-only: preflights and
// unauthenticated POSTs, which every function refuses with 401 (or 503 when a
// secret is missing) before it touches anything.
//
//   bun scripts/smoke-cors.ts                         # the hosted project
//   bun scripts/smoke-cors.ts --base http://127.0.0.1:54321/functions/v1
//   bun scripts/smoke-cors.ts --at delete-account=http://127.0.0.1:9101 [--at …]
//
// For each function it plays what a browser does: a preflight that asks for the
// headers the app really sends (raw fetch: authorization + content-type;
// supabase.functions.invoke adds apikey + x-client-info), then the request
// itself, from the app's origins and from a foreign one. Exit 1 on any miss.

const HOSTED = "https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1";

const RAW = "authorization,content-type";
const INVOKE = "apikey,authorization,content-type,x-client-info";

/** Each function and the request headers its app caller sends. */
export const FUNCTIONS: Record<string, string> = {
  "analytics-forget": RAW,
  "create-portal-session": RAW,
  "delete-account": RAW,
  "create-checkout-session": RAW,
  "start-trial": RAW,
  "extend-trial": RAW,
  "calendar-google-web": INVOKE,
  "calendar-microsoft-web": INVOKE,
  "booking-google-connect": INVOKE,
  "booking-zoom-connect": INVOKE,
};

export const APP = [
  "https://app.moduo.app",
  "https://app.staging.moduo.app",
  "https://pr-1-moduo-app-staging.moduo.workers.dev",
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:8081",
];
export const FOREIGN = ["https://evil.example", "https://app.moduo.app.evil.example", "null"];

type Check = { fn: string; origin: string; step: string; ok: boolean; detail: string };

function headerList(value: string | null): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(",")
    .map((h) => h.trim());
}

/** A browser preflight from `origin`, asking for the headers the app sends. */
async function preflight(url: string, origin: string, want: string): Promise<[boolean, string]> {
  const pre = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": want,
    },
  });
  await pre.body?.cancel();
  const acao = pre.headers.get("access-control-allow-origin");
  if (!APP.includes(origin)) return [acao === null, `${pre.status} allow-origin=${acao}`];
  const allowed = headerList(pre.headers.get("access-control-allow-headers"));
  const missing = want.split(",").filter((h) => !allowed.includes(h));
  const methods = (pre.headers.get("access-control-allow-methods") ?? "").toUpperCase();
  const vary = headerList(pre.headers.get("vary"));
  const ok =
    pre.ok &&
    acao === origin &&
    missing.length === 0 &&
    methods.includes("POST") &&
    vary.includes("origin");
  return [
    ok,
    `${pre.status} allow-origin=${acao} missing-headers=[${missing}] methods=${methods} vary=${vary}`,
  ];
}

/** The request itself, unauthenticated: an app origin reads the 401 (or 503), a foreign one gets no grant. */
async function request(url: string, origin: string): Promise<[boolean, string]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  const got = res.headers.get("access-control-allow-origin");
  if (!APP.includes(origin)) return [got === null, `${res.status} allow-origin=${got}`];
  const ok = got === origin && (res.status === 401 || res.status === 503);
  return [ok, `${res.status} allow-origin=${got} ${text.slice(0, 60)}`];
}

async function checkOne(fn: string, url: string, want: string): Promise<Check[]> {
  const out: Check[] = [];
  for (const origin of [...APP, ...FOREIGN]) {
    const [preOk, preDetail] = await preflight(url, origin, want);
    out.push({ fn, origin, step: "preflight", ok: preOk, detail: preDetail });
    const [reqOk, reqDetail] = await request(url, origin);
    out.push({ fn, origin, step: "request", ok: reqOk, detail: reqDetail });
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let base = HOSTED;
  const at = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base") base = args[++i].replace(/\/$/, "");
    else if (args[i] === "--at") {
      const [fn, url] = args[++i].split(/=(.*)/s);
      at.set(fn, url);
    }
  }
  const targets = at.size
    ? [...at]
    : Object.keys(FUNCTIONS).map((fn) => [fn, `${base}/${fn}`] as const);
  let failed = 0;
  for (const [fn, url] of targets) {
    const checks = await checkOne(fn, url, FUNCTIONS[fn] ?? INVOKE);
    const bad = checks.filter((c) => !c.ok);
    failed += bad.length;
    console.log(
      `${bad.length ? "FAIL" : "ok  "} ${fn} (${checks.length - bad.length}/${checks.length})`,
    );
    for (const c of bad) console.log(`     ${c.step} from ${c.origin}: ${c.detail}`);
  }
  if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
  }
}
