/**
 * OPS-2 — prod-schema ↔ migration-file reconciliation (CLI shell).
 *
 * `bun run db:reconcile` prints four read-only SQL queries. Paste each into the
 * Supabase MCP `execute_sql` — each returns ONLY mismatches, so a clean database
 * answers with an empty result.
 *
 * All parsing/normalization lives in `src/lib/db-reconcile-core.ts` so that
 * `bun run verify` typechecks and tests it (nothing under scripts/ is in tsconfig).
 *
 * WHY THIS EXISTS: nothing else compares the migration files to the database.
 * `bun run verify` never touches Postgres, and `list_migrations` only shows names
 * someone typed at apply time — it cannot see a partial apply, a hand-run
 * `execute_sql`, or a replaced function body. EM-6 sat undeployed ~3 weeks behind
 * exactly that blind spot: the function EXISTED, so existence checks passed, while
 * its body was the stale one-branch version. Query 2 is the one that catches that.
 *
 * READ THE LIMITS. A clean run does NOT mean "the schema is verified" — see the
 * UNCHECKED list printed in the header. Notably functions are matched by NAME, so a
 * stray overload (the `calendar_op_account_upsert` 7→8 arg case, which needed an
 * explicit DROP to avoid PostgREST ambiguity) reads as present in query 1 and
 * drift-free in query 2. Query 3 exists to catch precisely that. Query 4 is the one
 * grants check: internal SECURITY DEFINER helpers a client role can call.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ANON_DEFINER_ALLOWED,
  dedupeByLastDefiner,
  dedupeDecls,
  normalizeBody,
  parseDeclarations,
  parseFunctionBodies,
  sqlQuote,
  UNCHECKED,
} from "../src/lib/db-reconcile-core";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (f: string) => readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8");

const decls = dedupeDecls(files.flatMap((f) => parseDeclarations(read(f), f)));
const bodies = dedupeByLastDefiner(files.flatMap((f) => parseFunctionBodies(read(f), f)));
const list = (kind: string) =>
  sqlQuote(
    decls
      .filter((d) => d.kind === kind)
      .map((d) => d.name)
      .sort()
      .join(","),
  );

const NORM =
  `regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(p.prosrc,'/\\*.*?\\*/',' ','g'),` +
  `'--[^\\n]*',' ','g'),'\\s+',' ','g')),'\\s*([(),;=])\\s*','\\1','g')`;

const filesDeclaring = new Set(decls.map((d) => d.file)).size;
console.log(
  `-- ${files.length} migration files (${filesDeclaring} declare objects) -> ${decls.length} objects, ${bodies.length} function bodies`,
);
console.log(`--`);
console.log(`-- NOT CHECKED by any query below:`);
for (const u of UNCHECKED) console.log(`--   * ${u}`);
console.log(
  `-- An empty result means "nothing in the checked categories drifted", NOT "the schema is verified".`,
);

console.log(`\n\n-- ===== QUERY 1: declared in migrations, MISSING from prod =====\n`);
console.log(`with d_fn(name) as (select unnest(string_to_array(${list("function")},','))),
     d_tbl(name) as (select unnest(string_to_array(${list("table")},','))),
     d_col(ref) as (select unnest(string_to_array(${list("column")},','))),
     d_trg(name) as (select unnest(string_to_array(${list("trigger")},','))),
     d_pol(ref) as (select unnest(string_to_array(${list("policy")},','))),
     d_view(name) as (select unnest(string_to_array(${list("view")},',')))
select 'MISSING function' as issue, name as object from d_fn f where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.name)
union all select 'MISSING table', name from d_tbl t where not exists (
  select 1 from information_schema.tables where table_schema='public' and table_name=t.name)
union all select 'MISSING column', ref from d_col c where not exists (
  select 1 from information_schema.columns where table_schema='public'
    and table_name=split_part(c.ref,'.',1) and column_name=split_part(c.ref,'.',2))
-- tgrelid is checked so a same-named trigger on the WRONG table still reports, and
-- tgenabled so a disabled trigger (tgenabled<>'O') is not counted as present.
union all select 'MISSING or DISABLED trigger', name from d_trg g where not exists (
  select 1 from pg_trigger tg join pg_class c on c.oid=tg.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
  where tg.tgname=g.name and not tg.tgisinternal and n.nspname='public' and tg.tgenabled='O')
union all select 'MISSING policy', ref from d_pol p where not exists (
  select 1 from pg_policies where schemaname='public'
    and tablename=split_part(p.ref,'::',1) and policyname=split_part(p.ref,'::',2))
union all select 'MISSING view', name from d_view v where not exists (
  select 1 from information_schema.views where table_schema='public' and table_name=v.name)
order by 1,2;`);

const values = bodies
  .map(
    (b) =>
      `(${sqlQuote(b.name)},'${createHash("md5").update(normalizeBody(b.body)).digest("hex")}')`,
  )
  .join(",");

console.log(`\n\n-- ===== QUERY 2: function BODY DRIFT + prod-only functions =====\n`);
console.log(`with repo(name,md5) as (values ${values}),
prod as (select p.proname as name, md5(${NORM}) as md5
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
select 'BODY DRIFT' as issue, r.name as object from repo r
  where not exists (select 1 from prod where prod.name=r.name and prod.md5=r.md5)
union all
select 'IN PROD, NOT IN ANY MIGRATION', p.name from prod p
  where not exists (select 1 from repo where repo.name=p.name)
group by 1,2
order by 1,2;`);

console.log(`\n\n-- ===== QUERY 3: overload ambiguity (query 1 + 2 are blind to this) =====\n`);
console.log(`-- A declared function name carrying >1 prod overload: query 1 sees "present" and
-- query 2 sees "some overload matches", while every PostgREST RPC on that name 300s.
-- This is why 20260703130000 had to DROP the 7-arg calendar_op_account_upsert.
with d_fn(name) as (select unnest(string_to_array(${list("function")},',')))
select 'AMBIGUOUS OVERLOAD' as issue, f.name as object,
       string_agg(pg_get_function_identity_arguments(p.oid), ' | ') as signatures
from d_fn f
join pg_proc p on p.proname = f.name
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
group by f.name having count(*) > 1
order by 2;`);

console.log(
  `\n\n-- ===== QUERY 4: SECURITY DEFINER functions a client can call but shouldn't =====\n`,
);
console.log(`-- \`*__*\` helpers are internal: only other SECURITY DEFINER functions call them, as
-- the owner, so no client role needs EXECUTE. anon gets no definer function outside
-- the allowlist (ANON_DEFINER_ALLOWED in db-reconcile-core.ts). Supabase grants anon
-- and authenticated EXECUTE directly, so a REVOKE naming only PUBLIC leaves both
-- (gotchas §Supabase). Trigger functions are skipped; Postgres won't call them as RPCs.
with allow(name) as (select unnest(string_to_array(${sqlQuote(Object.keys(ANON_DEFINER_ALLOWED).sort().join(","))},','))),
defs as (
  select p.oid::regprocedure::text as object, p.proname, p.prorettype,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
)
select 'CLIENT-EXECUTABLE INTERNAL HELPER' as issue, object,
       concat_ws(',', case when anon then 'anon' end, case when auth then 'authenticated' end) as roles
from defs where proname like '%\\_\\_%' and (anon or auth)
union all
select 'ANON-EXECUTABLE SECURITY DEFINER', object, 'anon'
from defs where anon and proname not like '%\\_\\_%' and prorettype <> 'trigger'::regtype
  and proname not in (select name from allow)
order by 1, 2;`);
