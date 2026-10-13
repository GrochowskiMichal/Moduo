import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { Constants } from "@/types/supabase";

import { ATTACHMENTS_BUCKET } from "./attachments.ts";
import { TOOL_ARG_SCHEMAS } from "./mcp-tool-args.ts";
import {
  ACCESS_CHANGE_RESOURCES,
  ATTACHMENT_DELETED_REASONS,
  ATTACHMENT_PREVIEW_MIMES,
  ATTACHMENT_STATUSES,
  CALENDAR_ACCOUNT_STATUSES,
  COMMENT_REACTIONS,
  CONTENT_AUTHOR_KINDS,
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
  TASK_VIEW_SCOPES,
  TASK_WAITING_KINDS,
  TEMPLATE_KINDS,
  TEMPLATE_LINK_TYPES,
  WAITLIST_ROW_SOURCES,
  WAITLIST_SOURCES,
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
    const gate = read("20261010150000_tx4_invite_only_gate.sql");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    // The landing joins with a CTA source only; the row CHECK also allows `manual`.
    expect(join).toContain(`p_source NOT IN (${inList(WAITLIST_SOURCES)})`);
    expect(gate).toContain(`source IN (${inList(WAITLIST_ROW_SOURCES)})`);
    expect(gate).toContain(`status IN (${inList(WAITLIST_STATUSES)})`);
  });

  it("email_subscriptions CHECKs list the canonical subscription vocabularies (TX-4)", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261010150000_tx4_invite_only_gate.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`topic IN (${inList(EMAIL_SUBSCRIPTION_TOPICS)})`);
    expect(sql).toContain(`status IN (${inList(EMAIL_SUBSCRIPTION_STATUSES)})`);
    expect(sql).toContain(`source IN (${inList(EMAIL_SUBSCRIPTION_SOURCES)})`);
  });

  it("email_outbox CHECKs list the canonical email vocabularies", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261008160000_email_outbox.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`kind IN (${inList(EMAIL_KINDS)})`);
    expect(sql).toContain(`stream IN (${inList(EMAIL_STREAMS)})`);
    expect(sql).toContain(`status IN (${inList(EMAIL_OUTBOX_STATUSES)})`);
  });

  it("email_suppressions CHECK lists the canonical suppression reasons", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261008233000_email_outbox_worker.sql"), "utf8");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`reason IN (${inList(EMAIL_SUPPRESSION_REASONS)})`);
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
    expect(sql).toContain(`deleted_reason IN (${inList(ATTACHMENT_DELETED_REASONS)})`);
    expect(sql).toContain(`preview_mime IN (${inList(ATTACHMENT_PREVIEW_MIMES)})`);
    expect(sql).toContain(`p_preview_mime NOT IN (${inList(ATTACHMENT_PREVIEW_MIMES)})`);
    expect(sql).toContain(`bucket_id = '${ATTACHMENTS_BUCKET}'`);
  });

  it("grant origins match the resource_grants CHECK", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261010120000_tighten_write_checks.sql"),
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

  it("the six comment reactions match TV-U13's CHECK and op", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261013100000_comment_reactions_edits.sql"),
      "utf8",
    );
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    const opList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`CHECK (reaction IN (${inList(COMMENT_REACTIONS)}))`);
    expect(sql).toContain(`p_reaction NOT IN (${opList(COMMENT_REACTIONS)})`);
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
  });

  it("the booking busy read leaves out the closed categories (TV-D10-fix)", () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, "20261011110000_task_sessions_access.sql"), "utf8");
    const opList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(sql).toContain(`'todo') NOT IN (${opList(TASK_CLOSED_CATEGORIES)})`);
  });

  it("repeat modes and notice delivery kinds match the server's checks (TV-D8, TV-D12)", () => {
    const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    const ops = read("20261010160000_tasks_ops_registry_handles.sql");
    expect(RECURRENCE_MODES).toEqual(["after_completion"]);
    expect(ops).toContain(`p_rec ->> 'mode' <> '${RECURRENCE_MODES[0]}'`);
    const notices = read("20261013110000_notifications_v3.sql");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
    expect(notices).toContain(`kind text NOT NULL CHECK (kind IN (${inList(NOTICE_DELIVERY_KINDS)}))`);
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
