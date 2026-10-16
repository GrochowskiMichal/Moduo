/**
 * CV-9: a key reads no chat file through the connector. The connector reads
 * as the service role (no row policies), so this rests on its code: the only
 * tool that reads `attachments` asks for task files, and no other module (chat
 * included) reads the table or the bucket. The SQL side (chat_files and begin
 * refuse a key) is in supabase/tests/chat_files.test.sql.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@rstest/core";

const DIR = dirname(fileURLToPath(import.meta.url));
const sources = [
  ...readdirSync(DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => resolve(DIR, f)),
  ...readdirSync(resolve(DIR, "modules"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => resolve(DIR, "modules", f)),
];

describe("the connector and chat files (CV-9)", () => {
  it("reads attachments only in the tasks module, and only task files", () => {
    const readers = sources.filter((p) => /from\("attachments"\)/.test(readFileSync(p, "utf8")));
    expect(readers.map((p) => p.slice(DIR.length + 1))).toEqual(["modules/tasks.ts"]);
    const tasks = readFileSync(resolve(DIR, "modules/tasks.ts"), "utf8");
    const reads = tasks.split('from("attachments")').slice(1);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.slice(0, 400)).toContain('.eq("entity_type", "task")');
    }
  });

  it("never names the chat file read or the chat_message files anywhere", () => {
    for (const p of sources) {
      const src = readFileSync(p, "utf8");
      expect(src).not.toContain("chat_files");
      expect(src).not.toMatch(/entity_type["'`,\s]+chat_message/);
    }
  });
});
