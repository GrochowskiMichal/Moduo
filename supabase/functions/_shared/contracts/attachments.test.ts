import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  ATTACHMENT_PER_FILE_BYTES,
  ATTACHMENT_PLATFORM_FILE_CAP_BYTES,
  CHAT_FILES_PER_MESSAGE,
} from "./attachments.ts";
import { PLAN_TIERS } from "./vocabularies.ts";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");
const sql = readFileSync(
  resolve(MIGRATIONS_DIR, "20261008210500_attachments_storage.sql"),
  "utf8",
);

// AT-2: the app words "your plan allows N MB per file" and offers Upgrade from
// these; the server (AT-1's SQL) is what actually enforces them.
describe("attachment limits mirror the AT-1 SQL", () => {
  it("covers every plan tier, and nothing else", () => {
    expect(Object.keys(ATTACHMENT_PER_FILE_BYTES).sort()).toEqual([...PLAN_TIERS].sort());
  });

  it("matches attachments__platform_file_cap()", () => {
    const m = /attachments__platform_file_cap\(\)[\s\S]*?SELECT (\d+)::bigint/.exec(sql);
    expect(Number(m?.[1])).toBe(ATTACHMENT_PLATFORM_FILE_CAP_BYTES);
  });

  it("matches attachments__chat_file_cap() (CV-9)", () => {
    const files = readFileSync(resolve(MIGRATIONS_DIR, "20261017115000_chat_v2_files.sql"), "utf8");
    const m = /attachments__chat_file_cap\(\)[\s\S]*?SELECT (\d+) \$\$/.exec(files);
    expect(Number(m?.[1])).toBe(CHAT_FILES_PER_MESSAGE);
  });

  it("matches the per-file CASE in storage__limits_for_owner", () => {
    const body = /storage__limits_for_owner[\s\S]*?least\(([\s\S]*?)attachments__platform_file_cap/.exec(
      sql,
    )?.[1];
    expect(body).toBeTruthy();
    const mb = (tier: string) =>
      Number(new RegExp(`WHEN '${tier}' THEN (\\d+)`).exec(body ?? "")?.[1]) * 1048576;
    for (const tier of ["founder", "team", "duo", "pro"] as const) {
      expect(mb(tier)).toBe(ATTACHMENT_PER_FILE_BYTES[tier]);
    }
    expect(Number(/ELSE (\d+)/.exec(body ?? "")?.[1]) * 1048576).toBe(
      ATTACHMENT_PER_FILE_BYTES.free,
    );
  });
});
