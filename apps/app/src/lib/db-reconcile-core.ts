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

/**
 * `dropped` marks a DROP: in file order, an object whose last mention is a drop is gone
 * and dedupeDecls leaves it out. `args` (functions only) is the overload's argument types,
 * normalized, so dropping an old signature doesn't hide a live one of the same name; null
 * means every overload (`DROP FUNCTION f;` without arguments).
 */
export type Decl = {
  kind: DeclKind;
  name: string;
  file: string;
  dropped?: boolean;
  args?: string | null;
};
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
  // Empty since 2026-10-23: calendar_public_feed(text), the one entry, was dropped.
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

/** The parenthesised text starting at `open` (an index of "("), without the parens. */
function parenText(sql: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return sql.slice(open + 1, i);
  }
  return null;
}

/** Split on top-level commas (`numeric(10,2)` stays one piece). */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

const TYPE_ALIASES: Record<string, string> = {
  timestamptz: "timestamp with time zone",
  timestamp: "timestamp without time zone",
  timetz: "time with time zone",
  int: "integer",
  int4: "integer",
  int8: "bigint",
  int2: "smallint",
  bool: "boolean",
  varchar: "character varying",
  float8: "double precision",
  float4: "real",
  decimal: "numeric",
};

/** First words of built-in types, so an unnamed `timestamp with time zone` isn't read as a name. */
const TYPE_WORDS = new Set([
  ...Object.keys(TYPE_ALIASES),
  ..."uuid text integer bigint smallint boolean jsonb json date time numeric double character real bytea interval regclass regtype anyelement anyarray inet citext tsvector record".split(
    " ",
  ),
]);

/**
 * The argument types of a CREATE parameter list or a DROP type list, normalized and
 * joined: names, defaults, modes and length modifiers go, OUT parameters don't count
 * (Postgres leaves them out of a signature), and aliases collapse (`timestamptz` →
 * `timestamp with time zone`).
 */
export function signatureArgs(list: string): string {
  const types: string[] = [];
  for (const raw of splitTopLevel(list)) {
    let p = raw
      .replace(/\s+(?:DEFAULT\b|=)[\s\S]*$/i, "")
      .replace(/"/g, "")
      .replace(/\bpublic\./gi, "")
      .trim()
      .toLowerCase();
    const mode = /^(in|out|inout|variadic)\s+/.exec(p);
    if (mode?.[1] === "out") continue;
    if (mode) p = p.slice(mode[0].length);
    const words = p.split(/\s+/);
    if (words.length > 1 && !TYPE_WORDS.has(words[0].replace(/[[(].*$/, ""))) words.shift();
    let t = words.join(" ").replace(/\s*\([^)]*\)/g, "");
    const array = t.endsWith("[]") ? "[]" : "";
    if (array) t = t.slice(0, -2).trim();
    types.push((TYPE_ALIASES[t] ?? t) + array);
  }
  return types.join(",");
}

/** Blank out dollar-quoted bodies, keeping offsets: a DROP in a DO block or function body is conditional or dynamic. */
function maskDollarQuoted(sql: string): string {
  return sql.replace(/(\$\w*\$)[\s\S]*?\1/g, (m) => " ".repeat(m.length));
}

/**
 * Objects a migration file declares, and the ones it drops, in file order. Runs on
 * comment-stripped SQL. Tables and policies key on the same capture for CREATE and
 * DROP (a policy on `storage.objects` is `storage::name` both ways), so a drop always
 * cancels its own create.
 */
export function parseDeclarations(rawSql: string, file: string): Decl[] {
  const sql = stripComments(rawSql);
  const found: { at: number; decl: Decl }[] = [];
  const push = (at: number, kind: DeclKind, name: string, extra: Partial<Decl> = {}) =>
    found.push({ at, decl: { kind, name, file, ...extra } });

  for (const m of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi,
  )) {
    const params = parenText(sql, m.index + m[0].length - 1);
    push(m.index, "function", m[1], { args: params === null ? null : signatureArgs(params) });
  }
  for (const m of sql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi,
  ))
    push(m.index, "table", m[1]);
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?/gi))
    push(m.index, "trigger", m[1]);
  for (const m of sql.matchAll(
    /CREATE\s+POLICY\s+(?:"([^"]+)"|(\w+))\s+ON\s+(?:public\.)?"?(\w+)"?/gi,
  ))
    push(m.index, "policy", `${m[3]}::${m[1] ?? m[2]}`);
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?"?(\w+)"?/gi))
    push(m.index, "view", m[1]);

  // Drops: top-level statements only. One inside a DO block or function body is
  // conditional, or rebuilt by EXECUTE right after (module_activity_gate_recipients),
  // which a static read can't follow; skipping it costs a false MISSING row, never a
  // hidden one. A statement may name several objects (`DROP FUNCTION a(int), b(text)`).
  const top = maskDollarQuoted(sql);
  for (const m of top.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([^;]*)/gi)) {
    const list = m[1];
    for (const f of list.matchAll(/(?:^|,)\s*(?:public\.)?"?(\w+)"?\s*(\()?/g)) {
      const args = f[2] ? parenText(list, (f.index ?? 0) + f[0].length - 1) : null;
      push(m.index, "function", f[1], {
        dropped: true,
        args: args === null ? null : signatureArgs(args),
      });
    }
  }
  for (const m of top.matchAll(/DROP\s+(TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?([^;]*)/gi))
    for (const n of m[2].matchAll(/(?:^|,)\s*(?:public\.)?"?(\w+)"?/g))
      push(m.index, m[1].toLowerCase() as DeclKind, n[1], { dropped: true });
  for (const m of top.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi))
    push(m.index, "trigger", m[1], { dropped: true });
  for (const m of top.matchAll(
    /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s+ON\s+(?:public\.)?"?(\w+)"?/gi,
  ))
    push(m.index, "policy", `${m[3]}::${m[1] ?? m[2]}`, { dropped: true });

  // Columns: an ADD counts wherever it is (a guarded ADD in a DO block is how most
  // land); a DROP only at top level, like the drops above. Masking keeps offsets, so
  // both passes share one timeline.
  for (const [text, dropped] of [
    [sql, false],
    [top, true],
  ] as const) {
    let offset = 0;
    for (const stmt of text.split(";")) {
      const t = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/i.exec(stmt);
      const col = dropped
        ? /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi
        : /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;
      if (t)
        for (const c of stmt.matchAll(col))
          push(offset + c.index, "column", `${t[1]}.${c[1]}`, dropped ? { dropped } : {});
      offset += stmt.length + 1;
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.decl);
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

/**
 * The objects that should exist now: the last mention of each wins, and a drop removes
 * it. Functions are tracked per overload (name + argument types) and come out once per name,
 * from its latest live overload; a name-wide drop removes every overload before it.
 */
export function dedupeDecls(decls: Decl[]): Decl[] {
  const last = new Map<string, Decl>();
  for (const d of decls) {
    if (d.kind === "function" && d.dropped && d.args == null) {
      for (const k of [...last.keys()]) if (k.startsWith(`function:${d.name}/`)) last.delete(k);
      continue;
    }
    const key =
      d.kind === "function" ? `function:${d.name}/${d.args ?? "?"}` : `${d.kind}:${d.name}`;
    // Map order is insertion order: re-insert so a later mention counts as the latest.
    last.delete(key);
    last.set(key, d);
  }
  const live = new Map<string, Decl>();
  for (const d of last.values()) if (!d.dropped) live.set(`${d.kind}:${d.name}`, d);
  return [...live.values()];
}

/** Bodies of the functions still declared, so a dropped one isn't compared for drift. */
export function liveBodies(bodies: FnBody[], decls: Decl[]): FnBody[] {
  const fns = new Set(decls.filter((d) => d.kind === "function").map((d) => d.name));
  return bodies.filter((b) => fns.has(b.name));
}
