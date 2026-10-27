import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

// SQL-authoring checks over `supabase/migrations/*.sql`, one per SQL trap (formerly
// docs/gotchas/supabase.md entries) that a regex can catch. Like migration-order.test.ts it is a
// repo-hygiene guard (no database, no network): the SQL never runs in `bun run verify`,
// so these traps would otherwise reach prod unseen.
//
// Applied migrations are history and are never edited, so each check reads only files
// stamped at or after its `since` (default CUTOFF). Every check also carries a `bad` and
// a `good` snippet, asserted below, so a regex that stops matching fails here first.
//
// To add a check: append an entry to CHECKS with its gotcha, a `fix` that tells the
// author what to write instead, and the two snippets. Keep a check mechanical: if it
// needs judgement, it belongs in .claude/rules/supabase-sql.md instead.

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

/** Files stamped before this are applied history; checks apply from here on. */
const CUTOFF = "20261009000000";

// ── Parsing (deliberately small: comments stripped, statements split on `;`) ──────────

const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const bareName = (name: string) =>
  name
    .replace(/"/g, "")
    .replace(/^public\./i, "")
    .toLowerCase();

/** Text between the `(` at `open` and its matching `)`. */
const parenBody = (text: string, open: number) => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
};

const splitTopLevel = (text: string) => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
};

/** `name/<input arg count>`: overloads are separate functions with separate grants. */
const sigKey = (name: string, args: string) =>
  `${bareName(name)}/${splitTopLevel(args).filter((a) => !/^OUT\s/i.test(a)).length}`;

/** Every `name(args)` in a list such as `ON FUNCTION a(uuid), public.b(text)`. */
const signaturesIn = (text: string) => {
  const keys: string[] = [];
  for (const m of text.matchAll(/([\w."]+)\s*\(/g)) {
    if (/^(?:public\.)?%s$/i.test(m[1]) || /^format$/i.test(m[1])) continue;
    const open = m.index + m[0].length - 1;
    keys.push(sigKey(m[1], parenBody(text, open)));
  }
  return keys;
};

type SqlFunction = { key: string; at: number; definer: boolean; body: string };

const functionsIn = (sql: string): SqlFunction[] => {
  const out: SqlFunction[] = [];
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    const as = /\bAS\s+(\$\w*\$)/gi;
    as.lastIndex = open;
    const a = as.exec(sql);
    if (!a) continue;
    const close = sql.indexOf(a[1], a.index + a[0].length);
    if (close < 0) continue;
    const end = sql.indexOf(";", close + a[1].length);
    const attributes = `${sql.slice(open, a.index)} ${sql.slice(close + a[1].length, end < 0 ? undefined : end)}`;
    out.push({
      key: sigKey(m[1], parenBody(sql, open)),
      at: m.index,
      definer: /SECURITY\s+DEFINER/i.test(attributes),
      body: sql.slice(a.index + a[0].length, close),
    });
  }
  return out;
};

const ROLES = ["public", "anon", "authenticated", "service_role"] as const;
type Acl = { revoked: Set<string>; granted: Set<string> };

/**
 * Roles each function signature is REVOKEd from / GRANTed to in one file. Reads plain
 * statements, `EXECUTE '…'` strings and the house grant loop
 * (`FOREACH fn IN ARRAY ARRAY['f(uuid)', …] LOOP EXECUTE format('REVOKE …', fn); END LOOP`).
 */
const aclIn = (sql: string) => {
  const acl = new Map<string, Acl>();
  const note = (keys: string[], statement: string) => {
    const revoke = /\bREVOKE\b/i.test(statement);
    const roles = statement.match(revoke ? /\bFROM\b([\s\S]*)$/i : /\bTO\b([\s\S]*)$/i)?.[1];
    if (!roles) return;
    for (const key of keys) {
      const entry = acl.get(key) ?? { revoked: new Set(), granted: new Set() };
      for (const role of ROLES)
        if (new RegExp(`\\b${role}\\b`, "i").test(roles))
          entry[revoke ? "revoked" : "granted"].add(role);
      acl.set(key, entry);
    }
  };
  const read = (text: string, loopKeys: string[] | null) => {
    for (const raw of text.split(";")) {
      const at = raw.search(/\b(?:REVOKE|GRANT)\b/i);
      if (at < 0 || !/\bON\s+FUNCTION\b/i.test(raw)) continue;
      const statement = raw.slice(at);
      const target = statement.match(/\bON\s+FUNCTION\s+([\s\S]*?)\s(?:FROM|TO)\s/i)?.[1] ?? "";
      note(loopKeys ?? signaturesIn(target), statement);
    }
  };
  const loop = /FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\s*\[([\s\S]*?)\]\s*LOOP([\s\S]*?)END\s+LOOP/gi;
  for (const m of sql.matchAll(loop)) read(m[2], signaturesIn(m[1]));
  read(sql.replace(loop, " "), null);
  return acl;
};

// ── The migration set, with what each file creates fresh ───────────────────────────────

type Migration = {
  name: string;
  sql: string;
  functions: SqlFunction[];
  /** Functions this file creates for the first time, or DROPs and re-creates: their grants reset. */
  fresh: SqlFunction[];
  acl: Map<string, Acl>;
};

const analyse = (name: string, raw: string, seen: Set<string>): Migration => {
  const sql = stripComments(raw);
  const functions = functionsIn(sql);
  const drops = [...sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s*(\()?/gi)].map(
    (m) => ({
      at: m.index,
      key: m[2] ? sigKey(m[1], parenBody(sql, m.index + m[0].length - 1)) : `${bareName(m[1])}/*`,
    }),
  );
  const dropHits = (fn: SqlFunction, d: { key: string }) =>
    d.key === fn.key || d.key === `${fn.key.split("/")[0]}/*`;
  const fresh = functions.filter(
    (fn) =>
      !fn.key.startsWith("pg_temp.") &&
      // created then dropped in the same file: a throwaway helper
      !drops.some((d) => d.at > fn.at && dropHits(fn, d)) &&
      (!seen.has(fn.key) || drops.some((d) => d.at < fn.at && dropHits(fn, d))),
  );
  return { name, sql, functions, fresh, acl: aclIn(sql) };
};

const loadMigrations = () => {
  const seen = new Set<string>();
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const migration = analyse(name, readFileSync(resolve(MIGRATIONS_DIR, name), "utf8"), seen);
      for (const fn of migration.functions) seen.add(fn.key);
      return migration;
    });
};

const aclOf = (m: Migration, fn: SqlFunction) =>
  m.acl.get(fn.key) ?? { revoked: new Set<string>(), granted: new Set<string>() };

// ── Checks ─────────────────────────────────────────────────────────────────────────────

type Check = {
  id: string;
  /** The trap this enforces. */
  gotcha: string;
  /** What to write instead; printed with every failure. */
  fix: string;
  since?: string;
  find: (m: Migration) => string[];
  bad: string;
  good: string;
};

const CHECKS: Check[] = [
  {
    id: "new-function-grants",
    gotcha:
      "REVOKE … FROM PUBLIC does NOT revoke anon; DROP FUNCTION + CREATE resets grants (DF-21b, OPS-2)",
    fix:
      "a function this file creates (or DROPs and re-creates, which resets its grants to PUBLIC) needs its grants stated in the same file: " +
      "REVOKE ALL ON FUNCTION public.fn(args) FROM PUBLIC, anon (REVOKE FROM PUBLIC alone leaves anon able to execute, because Supabase grants anon directly), " +
      "then GRANT EXECUTE … TO authenticated, service_role for an app RPC (or TO anon too, deliberately, for a guest endpoint). " +
      "Put it in the file's grant loop if it has one, and assert has_function_privilege('anon', 'public.fn(args)', 'EXECUTE') = false in a SQL test",
    find: (m) =>
      m.fresh
        .filter((fn) => {
          const acl = aclOf(m, fn);
          return (
            !acl.revoked.has("public") || !(acl.revoked.has("anon") || acl.granted.has("anon"))
          );
        })
        .map((fn) => fn.key),
    bad: `CREATE FUNCTION public.x_op_go(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
          REVOKE ALL ON FUNCTION public.x_op_go(uuid) FROM PUBLIC;`,
    good: `CREATE FUNCTION public.x_op_go(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
           REVOKE ALL ON FUNCTION public.x_op_go(uuid) FROM PUBLIC, anon;
           GRANT EXECUTE ON FUNCTION public.x_op_go(uuid) TO authenticated, service_role;`,
  },
  {
    id: "internal-helper-grants",
    gotcha:
      "Internal SECURITY DEFINER helpers need authenticated revoked too (notes__purge_ids, share_grant_workspace)",
    fix:
      "an internal SECURITY DEFINER helper (double-underscore name, called only by other definer functions) gets " +
      "REVOKE ALL … FROM PUBLIC, anon, authenticated plus GRANT EXECUTE … TO service_role, inside the grant loop; " +
      "assert has_function_privilege for both client roles. Exceptions keep client EXECUTE (policy helpers, app RPCs, functions a CHECK, policy or trigger calls): " +
      "grant those TO authenticated explicitly so the choice is visible",
    find: (m) =>
      m.fresh
        .filter((fn) => fn.definer && fn.key.split("/")[0].includes("__"))
        .filter((fn) => {
          const acl = aclOf(m, fn);
          return !acl.revoked.has("authenticated") && !acl.granted.has("authenticated");
        })
        .map((fn) => fn.key),
    bad: `CREATE FUNCTION public.x__purge(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
          REVOKE ALL ON FUNCTION public.x__purge(uuid) FROM PUBLIC, anon;`,
    good: `CREATE FUNCTION public.x__purge(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
           DO $$ DECLARE fn text; BEGIN
             FOREACH fn IN ARRAY ARRAY['x__purge(uuid)'] LOOP
               EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
               EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
             END LOOP;
           END $$;`,
  },
  {
    id: "share-bypass-restored",
    gotcha: "share.bypass is transaction-local (MOD-571, share_member_removed)",
    fix:
      "set_config('share.bypass', '1', true) lasts until the transaction ends, so save the caller's value first " +
      "(v_bypass := current_setting('share.bypass', true)) and put it back with " +
      "PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true) before every RETURN after the set, an early return included, and before the body ends",
    find: (m) =>
      m.functions
        .filter((fn) => /set_config\(\s*'share\.bypass'\s*,\s*'1'/i.test(fn.body))
        .filter((fn) => {
          if (!/current_setting\(\s*'share\.bypass'\s*,\s*true\s*\)\s*(?:;|INTO)/i.test(fn.body))
            return true;
          let on = false;
          const events =
            /set_config\(\s*'share\.bypass'\s*,\s*('1'|coalesce\(\s*\w+|[^,]*)|\bRETURN\b(?!\s+(?:NEXT|QUERY)\b)/gi;
          for (const e of fn.body.matchAll(events)) {
            if (e[1] === undefined) {
              if (on) return true;
            } else if (e[1] === "'1'") on = true;
            else if (/^coalesce/i.test(e[1])) on = false;
            else return true; // reset to a constant, not the caller's value
          }
          return on;
        })
        .map((fn) => fn.key),
    bad: `CREATE OR REPLACE FUNCTION public.x_trg() RETURNS trigger LANGUAGE plpgsql AS $$
          DECLARE v_bypass text; BEGIN
            v_bypass := current_setting('share.bypass', true);
            PERFORM set_config('share.bypass', '1', true);
            IF NOT FOUND THEN RETURN OLD; END IF;
            PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
            RETURN OLD;
          END $$;`,
    good: `CREATE OR REPLACE FUNCTION public.x_trg() RETURNS trigger LANGUAGE plpgsql AS $$
           DECLARE v_bypass text; BEGIN
             v_bypass := current_setting('share.bypass', true);
             PERFORM set_config('share.bypass', '1', true);
             IF NOT FOUND THEN
               PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
               RETURN OLD;
             END IF;
             PERFORM set_config('share.bypass', coalesce(v_bypass, ''), true);
             RETURN OLD;
           END $$;`,
  },
  {
    id: "no-grant-all-to-clients",
    gotcha: "RLS does not gate TRUNCATE (waitlist, founders_interest)",
    fix:
      "never GRANT ALL to anon or PUBLIC: RLS does not gate TRUNCATE. Grant the client roles only the verbs they need " +
      "(GRANT SELECT … TO authenticated); a server-only table gets REVOKE ALL … FROM PUBLIC, anon, authenticated, " +
      "checked with has_table_privilege('anon', 'public.x', 'TRUNCATE') = false",
    find: (m) =>
      m.sql
        .split(";")
        .filter((s) => /\bGRANT\s+ALL\b/i.test(s) && /\bTO\b[\s\S]*\b(?:anon|public)\b/i.test(s))
        .map((s) => s.trim().replace(/\s+/g, " ").slice(0, 100)),
    bad: `GRANT ALL ON TABLE public.waitlist TO anon, authenticated;`,
    good: `REVOKE ALL ON TABLE public.waitlist FROM PUBLIC, anon, authenticated;
           GRANT ALL ON TABLE public.waitlist TO service_role;`,
  },
  {
    id: "storage-bucket-type",
    gotcha: "new buckets on current hosted Postgres must set type",
    fix:
      "storage.buckets.type (STANDARD / ANALYTICS / VECTOR) is NOT NULL on the hosted project: name it in the INSERT's column list. " +
      "If the bucket takes upload(…, { upsert: true }), give storage.objects SELECT + INSERT + UPDATE policies, not INSERT alone",
    find: (m) =>
      [...m.sql.matchAll(/INSERT\s+INTO\s+storage\.buckets\s*(\(([^)]*)\))?/gi)]
        .filter((b) => !/\btype\b/i.test(b[2] ?? ""))
        .map((b) => b[0].replace(/\s+/g, " ")),
    bad: `INSERT INTO storage.buckets (id, name, public) VALUES ('x', 'x', false);`,
    good: `INSERT INTO storage.buckets (id, name, public, type) VALUES ('x', 'x', false, 'STANDARD');`,
  },
  {
    id: "generic-trigger-field-guard",
    gotcha: "a generic trigger's NEW.x behind AND TG_TABLE_NAME (2026-10-06 outage)",
    fix:
      "PL/pgSQL resolves every NEW.x / OLD.x in an expression before evaluating it, so AND does not short-circuit: " +
      "`TG_TABLE_NAME = 'notes' AND NEW.parent_id …` errors with record \"new\" has no field on every other table. " +
      "Nest the field read in its own IF inside the table check, and test the trigger with a write on every table it is attached to",
    find: (m) =>
      [
        ...m.sql.matchAll(
          /\b(?:TG_TABLE_NAME|v_module|v_table)\s*(?:=\s*'[^']*'|IN\s*\([^)]*\))\s+AND\s+(?:NEW|OLD)\.\w+/gi,
        ),
        ...m.sql.matchAll(/\b(?:NEW|OLD)\.\w+[^;\n]*\bAND\s+TG_TABLE_NAME\b/gi),
      ].map((x) => x[0].replace(/\s+/g, " ")),
    bad: `CREATE FUNCTION public.x_trg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            IF TG_TABLE_NAME = 'notes' AND NEW.parent_id IS NOT NULL THEN RETURN NEW; END IF;
            RETURN NEW; END $$;`,
    good: `CREATE FUNCTION public.x_trg() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
             IF TG_TABLE_NAME = 'notes' THEN
               IF NEW.parent_id IS NOT NULL THEN RETURN NEW; END IF;
             END IF;
             RETURN NEW; END $$;`,
  },
  {
    id: "current-setting-coalesced",
    gotcha:
      "current_setting(name, true) is NULL when never set, and NULL poisons an OR chain or a NOT",
    fix:
      "wrap a setting read that is compared inside an assignment: v := coalesce(current_setting('share.bypass', true), '') = '1' " +
      "(a plain IF current_setting(…) = '1' THEN is safe)",
    since: "20261027000000",
    find: (m) =>
      [...m.sql.matchAll(/:=[^;]*?\bcurrent_setting\(\s*'[^']+'\s*,\s*true\s*\)\s*(?:=|<>|!=)/gi)]
        .filter((x) => !/coalesce\(/i.test(x[0]))
        .map((x) => x[0].replace(/\s+/g, " ").slice(0, 100)),
    bad: `DO $$ DECLARE v boolean; BEGIN v := current_setting('share.bypass', true) = '1'; END $$;`,
    good: `DO $$ DECLARE v boolean; BEGIN v := coalesce(current_setting('share.bypass', true), '') = '1'; END $$;`,
  },
  {
    id: "no-deployed-host-in-sql",
    gotcha: "a cron job that calls a hard-coded function URL makes the local stack call prod",
    fix:
      "read the function's URL and secret from Vault (vault.decrypted_secrets) and do nothing without them, " +
      "as notice_deliveries__kick does; never write a *.supabase.co host or a /functions/v1/ path into SQL",
    find: (m) =>
      [
        ...m.sql.matchAll(/https?:\/\/[a-z0-9-]+\.supabase\.co[^'\s]*|\/functions\/v1\/[\w-]*/gi),
      ].map((x) => x[0]),
    bad: `SELECT net.http_post(url := 'https://abc.supabase.co/functions/v1/worker');`,
    good: `SELECT net.http_post(url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'worker_url'));`,
  },
  {
    id: "pgrst-raise-has-headers",
    gotcha: "RAISE SQLSTATE 'PGRST' with status alone answers 500 PGRST121",
    fix:
      "give RAISE SQLSTATE 'PGRST' a DETAIL with both keys: " +
      "DETAIL = json_build_object('status', 403, 'headers', json_build_object())::text",
    find: (m) =>
      m.sql
        .split(";")
        .filter((st) => /RAISE\s+SQLSTATE\s+'PGRST'/i.test(st) && !/'headers'/i.test(st))
        .map((st) => st.trim().replace(/\s+/g, " ").slice(0, 100)),
    bad: `DO $$ BEGIN RAISE SQLSTATE 'PGRST' USING MESSAGE = '{"code":"x"}', DETAIL = json_build_object('status', 403)::text; END $$;`,
    good: `DO $$ BEGIN RAISE SQLSTATE 'PGRST' USING MESSAGE = '{"code":"x"}', DETAIL = json_build_object('status', 403, 'headers', json_build_object())::text; END $$;`,
  },
];

describe("supabase/migrations: SQL-authoring checks", () => {
  const migrations = loadMigrations();

  it("finds migrations at or after the cutoff", () => {
    expect(migrations.some((m) => m.name >= CUTOFF)).toBe(true);
  });

  for (const check of CHECKS) {
    it(`${check.id}: flags its bad snippet and passes its good one`, () => {
      const probe = (sql: string) => check.find(analyse("probe.sql", sql, new Set()));
      expect(
        probe(check.bad).length,
        `${check.id} no longer matches its bad snippet`,
      ).toBeGreaterThan(0);
      expect(probe(check.good), `${check.id} flags its good snippet`).toEqual([]);
    });

    it(`${check.id}: every migration since ${check.since ?? CUTOFF}`, () => {
      const since = check.since ?? CUTOFF;
      const failures = migrations
        .filter((m) => m.name >= since)
        .flatMap((m) => check.find(m).map((hit) => `${m.name}: ${hit}`));
      expect(failures, `${check.gotcha}. Fix: ${check.fix}`).toEqual([]);
    });
  }
});

describe("supabase/migrations: tasks_notify_spine", () => {
  it("the latest body stays definer, gated, and sends unblocked to notify_user_ids", () => {
    const latest = loadMigrations()
      .flatMap((m) => m.functions.filter((fn) => fn.key.startsWith("tasks_notify_spine/")))
      .at(-1);
    const why =
      "tasks_notify_spine must stay SECURITY DEFINER (module_activity_log is revoked from authenticated), " +
      "keep the creator_unknown / can_access('task', …) gate, and keep tasks.unblocked on notify_user_ids";
    expect(latest, why).toBeDefined();
    expect(latest?.definer, why).toBe(true);
    expect(latest?.body, why).toMatch(/creator_unknown/);
    expect(latest?.body, why).toMatch(/can_access\(\s*'task'/);
    expect(latest?.body, why).toMatch(/notify_user_ids/);
  });
});
