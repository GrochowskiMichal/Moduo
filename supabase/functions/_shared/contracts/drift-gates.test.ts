import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { Constants } from "@/types/supabase";

import { TOOL_ARG_SCHEMAS } from "./mcp-tool-args.ts";
import {
  CALENDAR_ACCOUNT_STATUSES,
  CALENDAR_PROVIDERS,
  EMAIL_ACCOUNT_STATUSES,
  EMAIL_PROVIDERS,
  MEMBER_DB_PERMISSIONS,
  MEMBER_DB_ROLES,
  PLAN_TIERS,
  TASK_STATUSES,
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
