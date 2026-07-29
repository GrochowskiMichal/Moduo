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
  "grants, SECURITY DEFINER, SET search_path, RLS-enabled, constraints, defaults",
] as const;

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

  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi))
    push("function", m[1]);
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi))
    push("table", m[1]);
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?(\w+)"?/gi))
    push("trigger", m[1]);
  for (const m of sql.matchAll(/CREATE\s+POLICY\s+(?:"([^"]+)"|(\w+))\s+ON\s+(?:public\.)?"?(\w+)"?/gi))
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
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
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
