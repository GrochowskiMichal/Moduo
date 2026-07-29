/**
 * OPS-2 — prod-schema ↔ migration-file reconciliation.
 *
 * `bun run db:reconcile` prints two SQL queries. Paste each into the Supabase MCP
 * `execute_sql` (read-only, safe to run against prod) — each returns ONLY mismatches,
 * so a clean database answers with an empty result.
 *
 * WHY THIS EXISTS: nothing else in the repo compares the migration files to the
 * database. `bun run verify` never touches Postgres, and `list_migrations` only shows
 * names someone typed at apply time — it cannot see a partial apply, a hand-run
 * `execute_sql`, or a function whose body was replaced. The EM-6 notify branch sat
 * undeployed for ~3 weeks behind exactly that blind spot: the function EXISTED, so
 * every existence check passed, while its body was the stale one-branch version.
 *
 * So query 2 (body drift) is the one that matters; query 1 is the cheap sanity pass.
 *
 * NORMALIZATION: bodies are compared after stripping comments, collapsing whitespace
 * and dropping spaces around `( ) , ; =`. That is deliberate — prod stores
 * `('edit','admin')` and `SET x=now()` where the repo files say `('edit', 'admin')`
 * and `SET x = now()`, because several modules were applied from a compacted copy of
 * their migration. Without this, 19 of 110 functions report as drifted on formatting
 * alone and bury any real finding. Both sides of the comparison must apply the SAME
 * steps in the SAME order — if you change one, change the other.
 */
import { readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../supabase/migrations");

const normalize = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),;=])\s*/g, "$1")
    .trim();

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

type Decl = { kind: string; name: string; file: string };

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const decls: Decl[] = [];
const bodies = new Map<string, { body: string; file: string }>();

for (const file of files) {
  const raw = await Bun.file(`${MIGRATIONS_DIR}/${file}`).text();
  const sql = stripComments(raw);
  const push = (kind: string, name: string) => decls.push({ kind, name, file });

  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi))
    push("function", m[1]);
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi))
    push("table", m[1]);
  for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+"?(\w+)"?/gi)) push("trigger", m[1]);
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

  // Function bodies, for the drift hash. Last definer wins — that is what prod
  // should currently match.
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const rest = raw.slice(m.index);
    const as = /\bAS\s+(\$\w*\$)/i.exec(rest);
    if (!as) continue;
    const start = as.index + as[0].length;
    const end = rest.indexOf(as[1], start);
    if (end === -1) continue;
    bodies.set(m[1], { body: rest.slice(start, end), file });
  }
}

const latest = new Map<string, Decl>();
for (const d of decls) latest.set(`${d.kind}:${d.name}`, d);
const unique = [...latest.values()];
const names = (kind: string) =>
  unique.filter((d) => d.kind === kind).map((d) => d.name).sort().join(",");

const NORM_SQL =
  `regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(p.prosrc,'/\\*.*?\\*/',' ','g'),` +
  `'--[^\\n]*',' ','g'),'\\s+',' ','g')),'\\s*([(),;=])\\s*','\\1','g')`;

console.log(`-- ${files.length} migration files -> ${unique.length} declared objects, ${bodies.size} function bodies`);
console.log(`\n-- ========== QUERY 1: objects declared in migrations but MISSING from prod ==========\n`);
console.log(`with d_fn(name) as (select unnest(string_to_array('${names("function")}',','))),
     d_tbl(name) as (select unnest(string_to_array('${names("table")}',','))),
     d_col(ref) as (select unnest(string_to_array('${names("column")}',','))),
     d_trg(name) as (select unnest(string_to_array('${names("trigger")}',','))),
     d_pol(ref) as (select unnest(string_to_array('${names("policy")}',','))),
     d_view(name) as (select unnest(string_to_array('${names("view")}',',')))
select 'MISSING function' as issue, name as object from d_fn f where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.name)
union all select 'MISSING table', name from d_tbl t where not exists (
  select 1 from information_schema.tables where table_schema='public' and table_name=t.name)
union all select 'MISSING column', ref from d_col c where not exists (
  select 1 from information_schema.columns where table_schema='public'
    and table_name=split_part(c.ref,'.',1) and column_name=split_part(c.ref,'.',2))
union all select 'MISSING trigger', name from d_trg g where not exists (
  select 1 from pg_trigger tg where tg.tgname=g.name and not tg.tgisinternal)
union all select 'MISSING policy', ref from d_pol p where not exists (
  select 1 from pg_policies where schemaname='public'
    and tablename=split_part(p.ref,'::',1) and policyname=split_part(p.ref,'::',2))
union all select 'MISSING view', name from d_view v where not exists (
  select 1 from information_schema.views where table_schema='public' and table_name=v.name)
order by 1,2;`);

const values = [...bodies.entries()]
  .map(([name, { body }]) => `('${name}','${createHash("md5").update(normalize(body)).digest("hex")}')`)
  .join(",");

console.log(`\n\n-- ========== QUERY 2: function BODY DRIFT (the check that catches an EM-6) ==========\n`);
console.log(`with repo(name,md5) as (values ${values}),
prod as (select p.proname as name, md5(${NORM_SQL}) as md5
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
select 'BODY DRIFT' as issue, r.name as object from repo r
  where not exists (select 1 from prod where prod.name=r.name and prod.md5=r.md5)
union all
select 'IN PROD, NOT IN ANY MIGRATION', p.name from prod p
  where not exists (select 1 from repo where repo.name=p.name)
order by 1,2;`);
