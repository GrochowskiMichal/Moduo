/**
 * OPS-2 — pure half of the prod-schema ↔ migration-file reconciliation.
 *
 * Lives under src/ (not scripts/) on purpose: `tsconfig.json` only includes src, so
 * anything in scripts/ is never typechecked, and `vitest` only collects
 * `src/**\/*.test.ts`. Keeping the parsing + normalization here means `bun run verify`
 * actually covers it — see db-reconcile-core.test.ts. `scripts/db-reconcile.ts` is a
 * thin CLI shell over this.
 */

/** What the reconciliation compares. Anything not listed here is NOT checked — see UNCHECKED. */
export type DeclKind = "function" | "table" | "column" | "trigger" | "policy" | "view";

export type Decl = { kind: DeclKind; name: string; file: string };
export type FnBody = { name: string; body: string; file: string };

/**
 * Categories the reconciliation does NOT cover. Stated here (and echoed into the CLI
 * output) so a clean run is never mistaken for "the schema is fully verified".
 */
export const UNCHECKED = [
  "indexes (47 CREATE INDEX statements are parsed by nothing)",
  "function SIGNATURES — matching is by name, so a stray overload reads as present",
  "table COLUMN SETS — only the 29 explicit ADD COLUMNs are checked, not base CREATE TABLE columns",
  "policy DEFINITIONS — USING / WITH CHECK / target roles are never compared, only the name",
  "which TABLE a trigger is on — query 1 checks it exists on some public table and is enabled, not that it is on the declared one",
  "grants beyond query 4 — it covers `*__*` SECURITY DEFINER helpers and the SECURITY DEFINER functions anon can run (triggers and ANON_DEFINER_ALLOWED excepted); whether a SECURITY DEFINER function `authenticated` can call checks its caller is NOT checked",
  "SECURITY DEFINER vs INVOKER — a function's mode is never compared with the repo",
  "SET search_path, RLS-enabled, constraints, defaults",
] as const;

/**
 * SECURITY DEFINER functions anon may EXECUTE, each for a stated reason. Keyed by
 * signature (`name(type, type)`, as `oidvectortypes` prints it), so a new overload is
 * not covered by an old entry. Query 4 reports every other one. Remove an entry once
 * its reason is gone.
 */
export const ANON_DEFINER_ALLOWED: Record<string, string> = {
  "calendar_public_feed(text)": "public ICS feed; the token is the credential",
  // OPS-2 group 3 (gotchas/supabase.md): RLS policies for role `public` call these, so
  // revoking anon turns an anonymous empty read into a permission error. Scope those
  // policies `TO authenticated` first, then revoke and drop these entries.
  "profile_plan_tier_text(uuid)": "RLS helper for `public`-role policies (OPS-2 group 3)",
  "tasks_module_can_access_workspace(uuid)":
    "RLS helper for `public`-role policies (OPS-2 group 3)",
  "workspaces_owned_count_for_user(uuid)": "RLS helper for `public`-role policies (OPS-2 group 3)",
};

/**
 * Query 4: SECURITY DEFINER functions in `public` that a client role can call but
 * shouldn't. `*__*` helpers are internal (only other definer functions call them, as
 * the owner), so any client EXECUTE on one is reported. Every other definer function anon
 * can run is reported unless its signature is in `allowed`. Trigger functions are skipped in
 * both branches: Postgres won't call them as RPCs.
 */
export function clientCallableDefinerQuery(
  allowed: Record<string, string> = ANON_DEFINER_ALLOWED,
): string {
  const signatures = Object.keys(allowed).sort().map(sqlQuote).join(", ");
  return `with allow(sig) as (select unnest(array[${signatures}]::text[])),
defs as (
  select p.oid::regprocedure::text as object, p.proname,
         p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
)
select 'CLIENT-EXECUTABLE INTERNAL HELPER' as issue, object,
       concat_ws(',', case when anon then 'anon' end, case when auth then 'authenticated' end) as roles
from defs where proname like '%\\_\\_%' and (anon or auth)
union all
select 'ANON-EXECUTABLE SECURITY DEFINER', object, 'anon'
from defs where anon and proname not like '%\\_\\_%'
  and sig not in (select sig from allow)
order by 1, 2;`;
}

/** Strip SQL comments. Both extractors run on this, so a commented-out CREATE never counts. */
export function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Normalize a function body for comparison. MUST mirror the SQL side exactly.
 *
 * Steps 4/5 exist because prod and the repo disagree on cosmetic spacing: prod stores
 * `('edit','admin')` / `SET x=now()` where the files say `('edit', 'admin')` /
 * `SET x = now()`, because email, contacts-v2 and workspace-roles were applied from a
 * compacted copy. Without them 19 of 110 functions report as drifted on formatting
 * alone and bury anything real.
 *
 * KNOWN LIMIT: this rewrites inside string literals too, so `'needs edit, admin'` and
 * `'needs edit,admin'` hash identically. Prefer a false negative here over 19 false
 * positives, but it means "zero drift" is "zero drift outside string-literal spacing".
 */
export function normalizeBody(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),;=])\s*/g, "$1")
    .trim();
}

/** Single-quote a value for embedding in generated SQL. */
export function sqlQuote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** Objects a migration file declares. Runs on comment-stripped SQL. */
export function parseDeclarations(rawSql: string, file: string): Decl[] {
  const sql = stripComments(rawSql);
  const out: Decl[] = [];
  const push = (kind: DeclKind, name: string) => out.push({ kind, name, file });

  for (const m of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi,
  ))
    push("function", m[1]);
  for (const m of sql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi,
  ))
    push("table", m[1]);
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?/gi))
    push("trigger", m[1]);
  for (const m of sql.matchAll(
    /CREATE\s+POLICY\s+(?:"([^"]+)"|(\w+))\s+ON\s+(?:public\.)?"?(\w+)"?/gi,
  ))
    push("policy", `${m[3]}::${m[1] ?? m[2]}`);
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?(\w+)"?/gi))
    push("view", m[1]);

  for (const stmt of sql.split(";")) {
    const t = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/i.exec(stmt);
    if (!t) continue;
    for (const c of stmt.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi))
      push("column", `${t[1]}.${c[1]}`);
  }
  return out;
}

/**
 * Function bodies, for the drift hash. Runs on the SAME comment-stripped SQL as
 * parseDeclarations — otherwise a `CREATE FUNCTION foo(` inside a comment would enter
 * the body set but not the declared set and surface as a phantom BODY DRIFT row.
 */
export function parseFunctionBodies(rawSql: string, file: string): FnBody[] {
  const sql = stripComments(rawSql);
  const out: FnBody[] = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    const rest = sql.slice(m.index);
    const as = /\bAS\s+(\$\w*\$)/i.exec(rest);
    if (!as) continue;
    const start = as.index + as[0].length;
    const end = rest.indexOf(as[1], start);
    if (end === -1) continue;
    out.push({ name: m[1], body: rest.slice(start, end), file });
  }
  return out;
}

/** Last definer wins — that is the definition prod should currently match. */
export function dedupeByLastDefiner<T extends { name: string }>(items: T[]): T[] {
  const last = new Map<string, T>();
  for (const i of items) last.set(i.name, i);
  return [...last.values()];
}

export function dedupeDecls(decls: Decl[]): Decl[] {
  const last = new Map<string, Decl>();
  for (const d of decls) last.set(`${d.kind}:${d.name}`, d);
  return [...last.values()];
}
