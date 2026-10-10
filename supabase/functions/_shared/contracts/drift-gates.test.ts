import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { Constants } from "@/types/supabase";

import { ATTACHMENTS_BUCKET } from "./attachments.ts";
import { TOOL_ARG_SCHEMAS } from "./mcp-tool-args.ts";
import {
  ATTACHMENT_DELETED_REASONS,
  ATTACHMENT_PREVIEW_MIMES,
  ATTACHMENT_STATUSES,
  CALENDAR_ACCOUNT_STATUSES,
  CONTENT_AUTHOR_KINDS,
  EMAIL_KINDS,
  EMAIL_OUTBOX_STATUSES,
  EMAIL_STREAMS,
  EMAIL_SUPPRESSION_REASONS,
  CALENDAR_PROVIDERS,
  EMAIL_ACCOUNT_STATUSES,
  EMAIL_PROVIDERS,
  MEMBER_DB_PERMISSIONS,
  MEMBER_DB_ROLES,
  PLAN_TIERS,
  TASK_STATUSES,
  TASK_TIME_ACTIONS,
  TASK_TIME_ENTRY_KINDS,
  TASK_TIME_STATUSES,
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
    const base = read("20261001160000_waitlist_secure_join.sql");
    const latest = read("20261001170000_waitlist_footer_source.sql");
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(latest).toContain(`source IN (${inList(WAITLIST_SOURCES)})`);
    expect(latest).toContain(`p_source NOT IN (${inList(WAITLIST_SOURCES)})`);
    expect(base).toContain(`status IN (${inList(WAITLIST_STATUSES)})`);
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

  it("time entry kinds, actions and answers match the TV-D3 migration", () => {
    const sql = readFileSync(
      resolve(MIGRATIONS_DIR, "20261008225500_tasks_time_entries.sql"),
      "utf8",
    );
    const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
    expect(sql).toContain(`kind IN (${inList(TASK_TIME_ENTRY_KINDS)})`);
    expect(sql).toContain(`v_action NOT IN (${inList(TASK_TIME_ACTIONS)})`);
    for (const status of TASK_TIME_STATUSES) expect(sql).toContain(`'${status}'`);
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

  it("task statuses stay the closed set used by MCP parsers", () => {
    expect(TASK_STATUSES).toEqual(["todo", "in_progress", "done", "archived"]);
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
