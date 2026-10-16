import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { Constants } from "@/types/supabase";

import { ATTACHMENTS_BUCKET } from "./attachments.ts";
import { TOOL_ARG_SCHEMAS } from "./mcp-tool-args.ts";
import {
  ACCESS_CHANGE_RESOURCES,
  AGENT_LOUD_STATES,
  AGENT_SESSION_STATES,
  IMPORT_ENTITY_TYPES,
  IMPORT_ROW_ACTIONS,
  ATTACHMENT_DELETED_REASONS,
  ATTACHMENT_PREVIEW_MIMES,
  ATTACHMENT_STATUSES,
  CALENDAR_ACCOUNT_STATUSES,
  CHAT_CATCHUP_DONE_HOW,
  CHAT_CHANNEL_KINDS,
  CHAT_CATCHUP_REASONS,
  CHAT_EVENT_TYPES,
  CHAT_LINK_TARGETS,
  CHAT_MENTION_REASONS,
  CHAT_MESSAGE_KINDS,
  CHAT_NOTIFY_LEVELS,
  CLIENT_SURFACES,
  CHAT_PLAN_TIERS,
  CONTENT_AUTHOR_KINDS,
  DEFAULT_QUICK_REACTIONS,
  REACTION_KEY_SET,
  CHAT_CAPABILITIES,
  CUSTOM_EMOJI_KEY_PATTERN,
  CUSTOM_EMOJI_MAX_BYTES,
  CUSTOM_EMOJI_MAX_PX,
  CUSTOM_EMOJI_MIMES,
  CUSTOM_EMOJI_NAME_PATTERN,
  CUSTOM_EMOJI_PER_WORKSPACE,
  DATE_ORDERS,
  EMAIL_KINDS,
  EMAIL_OUTBOX_STATUSES,
  EMAIL_STREAMS,
  EMAIL_SUBSCRIPTION_SOURCES,
  EMAIL_SUBSCRIPTION_STATUSES,
  EMAIL_SUBSCRIPTION_TOPICS,
  EMAIL_SUPPRESSION_REASONS,
  CALENDAR_PROVIDERS,
  EMAIL_ACCOUNT_STATUSES,
  EMAIL_PROVIDERS,
  FOCUS_RUN_PHASES,
  FOCUS_RUN_STATUSES,
  FOCUS_TIMER_MODES,
  GRANT_LEVELS,
  GRANT_ORIGINS,
  HOUR_CYCLES,
  MEMBER_DB_PERMISSIONS,
  MEMBER_DB_ROLES,
  NOTICE_DELIVERY_KINDS,
  PLAN_TIERS,
  PROJECT_STATES,
  RECURRENCE_MODES,
  RELATION_KINDS,
  STARTER_TEMPLATES,
  SYNC_TOMBSTONE_TABLES,
  TASK_CLOSED_CATEGORIES,
  TASK_REMINDER_KINDS,
  TASK_STATUS_CATEGORIES,
  TASK_STATUSES,
  TASK_TIME_ACTIONS,
  TASK_TIME_ADJUSTMENT_REASONS,
  TASK_TIME_ENTRY_KINDS,
  TASK_TIME_STATUSES,
  TASK_VIEW_ID_DIMENSIONS,
  TASK_VIEW_SCOPES,
  TASK_VIEW_WORD_DIMENSIONS,
  TASK_WAITING_KINDS,
  TEMPLATE_KINDS,
  TEMPLATE_LINK_TYPES,
  WAITLIST_ROW_SOURCES,
  WAITLIST_SOURCES,
  STATUS_CLEAR_AFTER,
  STATUS_PRESETS,
  WAITLIST_STATUSES,
} from "./vocabularies.ts";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);

describe("cross-runtime drift guards", () => {
  it("PLAN_TIERS matches generated Database.public.Enums.plan_tier", () => {
    expect([...PLAN_TIERS]).toEqual([...Constants.public.Enums.plan_tier]);
  });

  it("task 4 CHECK migration lists the exact canonical IN-lists", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20260817130000_domain_contracts_checks.sql"),
      "utf8",
    );
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`role IN (${inList(MEMBER_DB_ROLES)})`);
    expect(sql).toContain(`permissions_notes IN (${inList(MEMBER_DB_PERMISSIONS)})`);
    expect(sql).toContain(`permissions_tasks IN (${inList(MEMBER_DB_PERMISSIONS)})`);
    expect(sql).toContain(`provider IN (${inList(EMAIL_PROVIDERS)})`);
    expect(sql).toContain(`status IN (${inList(EMAIL_ACCOUNT_STATUSES)})`);
    expect(sql).toContain(`provider IN (${inList(CALENDAR_PROVIDERS)})`);
    expect(sql).toContain(`status IN (${inList(CALENDAR_ACCOUNT_STATUSES)})`);
    expect(sql).toContain("founder");
  });

  it("waitlist migration CHECKs + join function list the canonical IN-lists", () => {
    const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const join = read("20261001170000_waitlist_footer_source.sql");
    const gate = read("20261010155652_tx4_invite_only_gate.sql");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    // The landing joins with a CTA source only; the row CHECK also allows `manual`.
    expect(join).toContain(`p_source NOT IN (${inList(WAITLIST_SOURCES)})`);
    expect(gate).toContain(`source IN (${inList(WAITLIST_ROW_SOURCES)})`);
    expect(gate).toContain(`status IN (${inList(WAITLIST_STATUSES)})`);
  });

  it("email_subscriptions CHECKs list the canonical subscription vocabularies (TX-4)", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261010155652_tx4_invite_only_gate.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`topic IN (${inList(EMAIL_SUBSCRIPTION_TOPICS)})`);
    expect(sql).toContain(`status IN (${inList(EMAIL_SUBSCRIPTION_STATUSES)})`);
    expect(sql).toContain(`source IN (${inList(EMAIL_SUBSCRIPTION_SOURCES)})`);
  });

  it("email_outbox CHECKs list the canonical email vocabularies", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261008160000_email_outbox.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    // The kind list was last re-stated by CV-6a (chat_waiting).
    const notices = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_chat_v2_device_notices.sql"));
    expect(notices).toBeDefined();
    const kinds = readFileSync(resolve(MIGRATIONS_DIR, notices ?? ""), "utf8");
    expect(kinds).toContain(`CHECK (kind IN (${inList(EMAIL_KINDS)}))`);
    expect(sql).toContain(`stream IN (${inList(EMAIL_STREAMS)})`);
    expect(sql).toContain(`status IN (${inList(EMAIL_OUTBOX_STATUSES)})`);
  });

  it("email_suppressions CHECK lists the canonical suppression reasons", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261008233000_email_outbox_worker.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`reason IN (${inList(EMAIL_SUPPRESSION_REASONS)})`);
  });

  it("chat v2 vocabularies match the …_chat_v2_foundation CHECKs (CV-1)", () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_chat_v2_foundation.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file ?? ""), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`CHECK (kind IN (${inList(CHAT_MESSAGE_KINDS)}))`);
    expect(sql).toContain(`(event ->> 'type') IN (${inList(CHAT_EVENT_TYPES)})`);
    expect(sql).toContain(`CHECK (reason IN (${inList(CHAT_CATCHUP_REASONS)}))`);
    expect(sql).toContain(`done_how IN (${inList(CHAT_CATCHUP_DONE_HOW)})`);
  });

  it("CHAT_CHANNEL_KINDS and CHAT_NOTIFY_LEVELS match v1's chat_channels and chat_members CHECKs (unchanged by v2)", () => {
    const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const sql = read("20261006150000_chat_module.sql");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`check (kind in (${inList(CHAT_CHANNEL_KINDS)}))`);
    expect(sql).toContain(`check (notify_level in (${inList(CHAT_NOTIFY_LEVELS)}))`);
    // No later migration re-cuts either CHECK.
    const later = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && f > "20261006150000")
      .filter((f) => /chat_channels_kind_check|chat_members_notify_level_check/.test(read(f)));
    expect(later).toEqual([]);
  });

  it("CHAT_LINK_TARGETS and RELATION_KINDS match the …_chat_v2_linked_channels CHECKs (CV-13)", () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_chat_v2_linked_channels.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file ?? ""), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`linked_type IN (${inList(CHAT_LINK_TARGETS)})`);
    const kinds = RELATION_KINDS.map((k) => `'${k}'::text`).join(", ");
    expect(sql.replace(/\s+/g, " ")).toContain(`relation_kind = ANY (ARRAY[${kinds}])`);
  });

  it("statuses vocabularies match the …_chat_v2_statuses CHECKs (CV-17)", () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_chat_v2_statuses.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file ?? ""), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    const spaced = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`preset IN (${inList(STATUS_PRESETS)})`);
    expect(sql).toContain(`clear_after IN (${inList(STATUS_CLEAR_AFTER)})`);
    // The ops check the same lists.
    expect(sql).toContain(`preset NOT IN (${spaced(STATUS_PRESETS)})`);
    expect(sql).toContain(`clear_after NOT IN (${spaced(STATUS_CLEAR_AFTER)})`);
  });

  it("CHAT_MENTION_REASONS are the reasons the fan-out writes on chat.mention rows (CV-5)", () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_chat_v2_catchup.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file ?? ""), "utf8");
    // chat__fan_out maps each Catch up reason to the bell row's reason.
    expect(sql).toContain(
      `CASE v_reason WHEN 'mention' THEN '${CHAT_MENTION_REASONS[0]}' WHEN 'team_mention' THEN '${CHAT_MENTION_REASONS[1]}'`,
    );
    expect(sql).toContain(`WHEN 'everyone' THEN '${CHAT_MENTION_REASONS[2]}' END`);
  });

  it("CHAT_PLAN_TIERS are plan_tier_rank's tiers at Duo or above; the plan source reads TX-9b's grant (CV-4)", () => {
    const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // The newest body of plan_tier_rank (a later migration may redefine it).
    const defines = /create\s+(?:or\s+replace\s+)?function\s+public\.plan_tier_rank\s*\(/i;
    const rankFile = migrations.filter((f) => defines.test(read(f))).at(-1);
    expect(rankFile).toBeDefined();
    const rankSql = read(rankFile ?? "");
    const body = rankSql.slice(rankSql.search(defines));
    const rank = new Map(
      [...body.slice(0, body.indexOf("$$;")).matchAll(/when '(\w+)' then (\d+)/g)].map(
        (m) => [m[1], Number(m[2])] as const,
      ),
    );
    const duo = rank.get("duo");
    expect(duo).toBeDefined();
    const atLeastDuo = PLAN_TIERS.filter((t) => (rank.get(t) ?? 0) >= (duo ?? Number.NaN));
    expect([...atLeastDuo].sort()).toEqual([...CHAT_PLAN_TIERS].sort());

    // The newest body of chat_workspace_enabled (CV-4's, re-cut by CV-23).
    const enabledDef = /create\s+(?:or\s+replace\s+)?function\s+public\.chat_workspace_enabled\s*\(/i;
    const file = migrations.filter((f) => enabledDef.test(read(f))).at(-1);
    expect(file).toBeDefined();
    const enabledSql = read(file ?? "");
    const sql = enabledSql.slice(enabledSql.search(enabledDef));
    expect(sql).toContain("to_regprocedure('public.plan_grant_effective_tier(uuid)')");
    expect(sql).toContain(">= public.plan_tier_rank('duo')");

    // TX-9b's grant function, once a migration defines it, must keep the signature
    // chat_workspace_enabled looks up, or handed-out workspaces silently lose chat.
    const grantDefs = migrations.flatMap((f) =>
      [
        ...read(f).matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]*plan_grant_effective_tier)\s*\(([^)]*)\)/gi),
      ].map((m) => ({ file: f, name: m[1], args: m[2].trim() })),
    );
    for (const def of grantDefs) {
      expect({ file: def.file, name: def.name, uuidOnly: /^(\w+\s+)?uuid$/i.test(def.args) }).toEqual({
        file: def.file,
        name: "public.plan_grant_effective_tier",
        uuidOnly: true,
      });
    }
  });

  it("content author kinds match the chat_messages and comments CHECKs", () => {
    const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const list = (values: readonly string[], sep: string) =>
      values.map((v) => `'${v}'`).join(sep);
    expect(read("20261006160000_chat_agent_access.sql")).toContain(
      `author_kind in (${list(CONTENT_AUTHOR_KINDS, ", ")})`,
    );
    expect(read("20261008123000_key_writes_act_as_creator.sql")).toContain(
      `author_kind IN (${list(CONTENT_AUTHOR_KINDS, ",")})`,
    );
  });

  it("CONTENT_AUTHOR_KINDS matches note_updates_origin_check (NR-6)", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261014120000_notes_agent_writes.sql"),
      "utf8",
    );
    const inList = CONTENT_AUTHOR_KINDS.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`CHECK (origin IN (${inList}))`);
  });

  it("time entry kinds, actions and answers match the TV-D14 re-cut of the TV-D3 migration", () => {
    const base = readFileSync(
      resolve(MIGRATIONS_DIR, "20261008225500_tasks_time_entries.sql"),
      "utf8",
    );
    const recutFile = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_time_entries_add.sql"));
    expect(recutFile).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, recutFile ?? ""), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`kind IN (${inList(TASK_TIME_ENTRY_KINDS)})`);
    expect(sql).toContain(`v_action NOT IN (${inList(TASK_TIME_ACTIONS)})`);
    expect(sql).toContain(`reason IN (${inList(TASK_TIME_ADJUSTMENT_REASONS)})`);
    expect(sql).toContain(`p_reason NOT IN (${inList(TASK_TIME_ADJUSTMENT_REASONS)})`);
    for (const status of TASK_TIME_STATUSES) expect(base).toContain(`'${status}'`);
  });

  it("Time & region's clock and date order match the user_preferences CHECKs (TV-D14)", () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) =>
      f.endsWith("_user_preferences_time_region.sql"),
    );
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file ?? ""), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`hour_cycle IN (${inList(HOUR_CYCLES)})`);
    expect(sql).toContain(`date_order IN (${inList(DATE_ORDERS)})`);
    expect(sql).toContain(`v_hour NOT IN (${inList(HOUR_CYCLES)})`);
    expect(sql).toContain(`v_order NOT IN (${inList(DATE_ORDERS)})`);
  });

  it("Focus run vocabularies match the focus_runs CHECKs (#323 + the TV-F6 re-cut)", () => {
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    const base = readFileSync(resolve(MIGRATIONS_DIR, "20261008235243_focus_runs.sql"), "utf8");
    expect(base).toContain(`status IN (${inList(FOCUS_RUN_STATUSES)})`);
    expect(base).toContain(`phase IN (${inList(FOCUS_RUN_PHASES)})`);
    const recutFile = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_focus_runs_v3.sql"));
    expect(recutFile).toBeDefined();
    const recut = readFileSync(resolve(MIGRATIONS_DIR, recutFile ?? ""), "utf8");
    expect(recut).toContain(`mode IN (${inList(FOCUS_TIMER_MODES)})`);
    expect(recut).toContain(`p_mode NOT IN (${inList(FOCUS_TIMER_MODES)})`);
    expect(recut).toContain(`s->>'mode' NOT IN (${inList(FOCUS_TIMER_MODES)})`);
  });

  it("attachment vocabularies match the attachments CHECKs and the ops (AT-1)", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261008210500_attachments_storage.sql"),
      "utf8",
    );
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`status IN (${inList(ATTACHMENT_STATUSES)})`);
    // CV-9 re-cut the deleted-reason CHECK (chat_message).
    const recut = readFileSync(resolve(MIGRATIONS_DIR, "20261017115000_chat_v2_files.sql"), "utf8");
    expect(recut).toContain(`deleted_reason IN (${inList(ATTACHMENT_DELETED_REASONS)})`);
    expect(sql).toContain(`preview_mime IN (${inList(ATTACHMENT_PREVIEW_MIMES)})`);
    expect(sql).toContain(`p_preview_mime NOT IN (${inList(ATTACHMENT_PREVIEW_MIMES)})`);
    expect(sql).toContain(`bucket_id = '${ATTACHMENTS_BUCKET}'`);
  });

  it("grant origins match the resource_grants CHECK", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261010141712_tighten_write_checks.sql"),
      "utf8",
    );
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`origin IN (${inList(GRANT_ORIGINS)})`);
    // The hand-set level an assignment raised: only levels below Edit.
    const belowEdit = GRANT_LEVELS.slice(0, GRANT_LEVELS.indexOf("edit"));
    expect(sql).toContain(`manual_level IN (${inList(belowEdit)})`);
  });

  it("task statuses stay the closed set used by MCP parsers", () => {
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "done", "archived"]);
  });

  it("task status categories match the project_statuses and tasks CHECKs (TV-D9)", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261010170000_project_statuses.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`CHECK (category IN (${inList(TASK_STATUS_CATEGORIES)}))`);
    expect(sql).toContain(`CHECK (status_category IN (${inList(TASK_STATUS_CATEGORIES)}))`);
    // The server's word reader and legacy mirror know every category.
    for (const c of TASK_STATUS_CATEGORIES) expect(sql).toContain(`THEN '${c}'`);
  });

  it("project states, reminder kinds and waiting kinds match the TV-D10 CHECKs and ops", () => {
    const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const structure = read("20261010180000_areas_projects_sections.sql");
    const sessions = read("20261010181000_task_sessions_reminders_waiting.sql");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    const opList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(structure).toContain(`CHECK (status IN (${inList(PROJECT_STATES)}))`);
    expect(structure).toContain(`NOT IN (${opList(PROJECT_STATES)})`);
    expect(sessions).toContain(`CHECK (kind IN (${inList(TASK_REMINDER_KINDS)}))`);
    expect(sessions).toContain(`p_kind NOT IN (${opList(TASK_REMINDER_KINDS)})`);
    expect(sessions).toContain(`CHECK (kind IN (${inList(TASK_WAITING_KINDS)}))`);
    expect(sessions).toContain(`v_kind NOT IN (${opList(TASK_WAITING_KINDS)})`);
  });

  it("the grant feed's resources and the tombstoned tables match TV-D11b's CHECKs", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261011120000_tasks_sync_feed_search.sql"),
      "utf8",
    );
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`CHECK (resource_type IN (${inList(ACCESS_CHANGE_RESOURCES)}))`);
    expect(sql).toContain(`CHECK (table_name IN (${inList(SYNC_TOMBSTONE_TABLES)}))`);
    // Every tombstoned table has its trigger.
    for (const t of SYNC_TOMBSTONE_TABLES) {
      expect(sql).toContain(`CREATE TRIGGER sync_tombstone AFTER DELETE ON public.${t}`);
    }
  });

  it("one reaction key: CV-7c's check, used by comments, chat and the quick row", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261017108000_chat_v2_reactions.sql"), "utf8");
    // The same rule as isReactionKey: the length, and the pattern spelled with
    // the same code points as REACTION_KEY_SET, in the same order.
    expect(sql).toContain("char_length(p_key) BETWEEN 1 AND 32");
    expect(sql).toContain("AND p_key ~ public.reactions__key_pattern()");
    const fnBody = (name: string) => {
      const at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(at, name).toBeGreaterThan(-1);
      return sql.slice(at, sql.indexOf("$function$;", at)).replace(/\s+/g, " ");
    };
    // Each list spelled as the SQL spells it: chr(n) for one code point,
    // chr(a) || '-' || chr(b) for a range, so the range ends are checked too.
    type R = number | readonly [number, number];
    const spell = (ranges: readonly R[]) =>
      ranges
        .map((r) => (typeof r === "number" ? `chr(${r})` : `chr(${r[0]}) || '-' || chr(${r[1]})`))
        .join(" || ");
    const s = REACTION_KEY_SET;
    const pattern = fnBody("reactions__key_pattern");
    expect(pattern).toContain(`'[' || ${spell(s.base)} || ']' AS base`);
    expect(pattern).toContain(`'[' || ${spell(s.vs)} || ']' AS vs`);
    expect(pattern).toContain(`'[' || ${spell(s.skin)} || ']' AS skin`);
    expect(pattern).toContain(`'[' || ${spell(s.tag)} || ']' AS tag`);
    expect(pattern).toContain(`chr(${s.tagEnd}) AS tag_end`);
    expect(pattern).toContain(`chr(${s.zwj}) AS zwj`);
    expect(pattern).toContain(`chr(${s.keycap}) AS keycap`);
    expect(pattern).toContain(`'[' || ${spell(s.ri)} || ']' AS ri`);
    const keycapBases = s.keycapBase
      .map((r) => (typeof r === "number" ? String.fromCodePoint(r) : `${String.fromCodePoint(r[0])}-${String.fromCodePoint(r[1])}`))
      .join("");
    expect(pattern).toContain(`'|[${keycapBases}]'`);
    // The one spelling: the keycap bases, then the text-default pictographs.
    const canonical = fnBody("reactions__key_canonical");
    expect(canonical).toContain(`SELECT '[${keycapBases}' || ${spell(s.textDefault)} || ']' AS td`);
    expect(sql).toContain("CHECK (public.reactions__key_ok(reaction))");
    expect(sql).toContain("IF NOT public.reactions__key_ok(p_reaction) THEN");
    expect(sql).toContain("IF NOT public.reactions__key_ok(p_key) THEN");
    expect(sql).toContain("IF NOT public.reactions__key_ok(v_item) THEN");
    // The six TV-U13 words became the six defaults, in order.
    const words = ["thumbs_up", "check", "eyes", "pray", "heart", "smile"];
    const mapping = words.map((w, i) => `('${w}', '${DEFAULT_QUICK_REACTIONS[i]}')`);
    let at = 0;
    for (const pair of mapping) {
      const next = sql.indexOf(pair, at);
      expect(next, pair).toBeGreaterThan(-1);
      at = next;
    }
  });

  it("custom emoji: CV-20's names, key, types, sizes, the switch and the reserved names", async () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261017122000_chat_v2_custom_emoji.sql"),
      "utf8",
    );
    // One name rule: the table's CHECK, the op and the reaction key.
    expect(sql).toContain(`CHECK (name ~ '^${CUSTOM_EMOJI_NAME_PATTERN}$')`);
    expect(sql).toContain(`IF v_name !~ '^${CUSTOM_EMOJI_NAME_PATTERN}$' THEN`);
    expect(sql).toContain(`SELECT '${CUSTOM_EMOJI_KEY_PATTERN}'::text`);
    expect(sql).toContain("OR p_key ~ public.reactions__custom_key_pattern())");
    // Types, sizes and the per-workspace limit.
    const mimes = CUSTOM_EMOJI_MIMES.map((m) => `'${m}'`).join(", ");
    expect(sql).toContain(`CHECK (mime IN (${mimes}))`);
    expect(sql).toContain(`ARRAY[${mimes}], 'STANDARD')`);
    expect(sql).toContain(`VALUES ('chat-emoji', 'chat-emoji', false, ${CUSTOM_EMOJI_MAX_BYTES},`);
    expect(sql).toContain(`CHECK (bytes BETWEEN 1 AND ${CUSTOM_EMOJI_MAX_BYTES})`);
    expect(sql).toContain(`CHECK (width BETWEEN 1 AND ${CUSTOM_EMOJI_MAX_PX})`);
    expect(sql).toContain(`AND e.deleted_at IS NULL) >= ${CUSTOM_EMOJI_PER_WORKSPACE} THEN`);
    // The switch is a capability the server knows.
    expect(CHAT_CAPABILITIES).toContain("add_emoji");
    expect(sql).toContain("WHEN 'add_emoji' THEN v_row.add_emoji");
    // The reserved names: Emojibase's GitHub shortcodes that fit the name rule.
    const github = (await import("emojibase-data/en/shortcodes/github.json")) as unknown as {
      default?: Record<string, string | string[]>;
    } & Record<string, string | string[]>;
    const codes = (github.default ?? github) as Record<string, string | string[]>;
    const nameRe = new RegExp(`^${CUSTOM_EMOJI_NAME_PATTERN}$`);
    const want = [...new Set(Object.values(codes).flat())].filter((n) => nameRe.test(n)).sort();
    const block = sql.slice(sql.indexOf("-- reserved:begin"), sql.indexOf("-- reserved:end"));
    const listed = block
      .slice(block.indexOf("'{") + 2, block.indexOf("}'"))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(listed).toEqual(want);
  });

  it("template kinds and link types match TV-D15's op guards", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261013160000_templates.sql"), "utf8");
    const opList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`p_kind NOT IN (${opList(TEMPLATE_KINDS)})`);
    expect(sql).toContain(`coalesce(l ->> 'type', '') NOT IN (${opList(TEMPLATE_LINK_TYPES)})`);
    expect(sql).toContain(`WHERE x.kind IN (${opList(TEMPLATE_LINK_TYPES)})`);
  });

  it("starter templates match TV-U17's op guard and bodies", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261013230000_templates_starter.sql"),
      "utf8",
    );
    const opList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`coalesce(v_key, '') NOT IN (${opList(STARTER_TEMPLATES)})`);
    for (const key of STARTER_TEMPLATES) expect(sql).toContain(`p_key = '${key}'`);
  });

  it("saved view scopes match TV-U8's CHECK and op guard", () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_task_views.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file as string), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    const opList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`CHECK (scope IN (${inList(TASK_VIEW_SCOPES)}))`);
    expect(sql).toContain(`v_scope NOT IN (${opList(TASK_VIEW_SCOPES)})`);
    // The filter's dimensions: the newest cut of task_views__check_filters
    // (MOD-141 added Project).
    const filtersFile = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        readFileSync(resolve(MIGRATIONS_DIR, f), "utf8").includes(
          "FUNCTION public.task_views__check_filters(\n",
        ),
      )
      .pop();
    expect(filtersFile).toBeDefined();
    const filtersSql = readFileSync(resolve(MIGRATIONS_DIR, filtersFile as string), "utf8");
    expect(filtersSql).toContain(`v_dim NOT IN (${opList(TASK_VIEW_ID_DIMENSIONS)})`);
    expect(filtersSql).toContain(`v_dim NOT IN (${opList(TASK_VIEW_WORD_DIMENSIONS)})`);
  });

  it("the booking busy read leaves out the closed categories (TV-D10-fix)", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261011110000_task_sessions_access.sql"), "utf8");
    const opList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`'todo') NOT IN (${opList(TASK_CLOSED_CATEGORIES)})`);
  });

  it("repeat modes and notice delivery kinds match the server's checks (TV-D8, TV-D12)", () => {
    const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const ops = read("20261010160001_tasks_ops_registry_handles.sql");
    expect(RECURRENCE_MODES).toEqual(["after_completion"]);
    expect(ops).toContain(`p_rec ->> 'mode' <> '${RECURRENCE_MODES[0]}'`);
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    // CV-6a re-states the CHECK with chat's kinds (TV-D16 added the agent's).
    const notices = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_chat_v2_device_notices.sql"));
    expect(notices).toBeDefined();
    const sql = read(notices ?? "");
    expect(sql).toContain(
      `ADD CONSTRAINT notice_deliveries_kind_check CHECK (kind IN (${inList(NOTICE_DELIVERY_KINDS)}))`,
    );
    expect(sql).toContain(`surface text NOT NULL CHECK (surface IN (${inList(CLIENT_SURFACES)}))`);
    expect(sql).toContain(`p_surface NOT IN (${inList(CLIENT_SURFACES)})`);
  });

  it("agent session states and import rows match the server's checks (TV-D16)", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261013220000_agents_imports_mcp.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`state text NOT NULL CHECK (state IN (${inList(AGENT_SESSION_STATES)}))`);
    expect(sql).toContain(`v_state NOT IN (${inList(AGENT_SESSION_STATES)})`);
    expect(sql).toContain(`v_state IN (${inList(AGENT_LOUD_STATES)})`);
    expect(sql).toContain(`entity_type text NOT NULL CHECK (entity_type IN (${inList(IMPORT_ENTITY_TYPES)}))`);
    expect(sql).toContain(`action text NOT NULL CHECK (action IN (${inList(IMPORT_ROW_ACTIONS)}))`);
  });

  it("every MCP module tool name has a TOOL_ARG_SCHEMAS parser and vice versa", () => {
    const modulesDir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../moduo-mcp/modules",
    );
    const listed = new Set<string>();
    for (const file of readdirSync(modulesDir)) {
      if (!file.endsWith(".ts")) continue;
      const src = readFileSync(join(modulesDir, file), "utf8");
      for (const match of src.matchAll(/name:\s*"([a-z0-9_]+)"/g)) {
        listed.add(match[1]!);
      }
    }
    expect([...listed].sort()).toEqual(Object.keys(TOOL_ARG_SCHEMAS).sort());
  });
});
