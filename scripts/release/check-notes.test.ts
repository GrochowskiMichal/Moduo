import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

import {
  buildDenyList,
  checkRepo,
  findLeaks,
  parseNote,
  SECURITY_LINE,
  shapeProblems,
} from "./check-notes.ts";

const deny = buildDenyList();
const words = (text: string) => findLeaks(text, deny).map((l) => l.word);

function tempRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-notes-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const note = (type: string, text: string, extra = "") =>
  `---\ntype: ${type}\ninternal: false\n${extra}---\n${text}\n`;

describe("release notes leak check", () => {
  it("accepts plain notes, names each leak", () => {
    for (const text of [
      "Tasks you snooze now come back at the start of your working day.",
      "Agents can now read your notes through MCP in Claude Desktop.",
      "Link GitHub pull requests to a task with one click, and see their status on the task.",
      "Sign-in is faster on macOS, and re-opening a note keeps your place.",
      "Moduo now remembers the last view you used (List or Board).",
    ]) {
      expect(findLeaks(text, deny)).toEqual([]);
    }

    expect(words("Fixed a crash in `TaskList` when saving.")).toEqual(["`", "TaskList"]);
    expect(words("Works with GitHub, YouTube links and your iPhone.")).toEqual([]);
    expect(words("Faster loading of apps/app/src/features/tasks.")).toEqual([
      "apps/app/src/features/tasks.",
    ]);
    expect(words("Updated update-toast.tsx for clarity.")).toContain("update-toast.tsx");
    expect(words("The taskStore now caches reads.")).toEqual(["taskStore"]);
    expect(words("Rows in task_links load faster.")).toEqual(["task_links"]);
    expect(words("The update-toast looks better.")).toEqual(["update-toast"]);
    expect(words("Finished MOD-114 and CV-2a.")).toEqual(["MOD-114", "CV-2a"]);
    expect(words("Calling refresh() is quicker.")).toContain("h(");
    expect(words("We tightened RLS and a migration on Supabase.")).toEqual([
      "RLS",
      "migration",
      "Supabase",
    ]);
    expect(words("Tokens now refresh through the Cloudflare Worker endpoint.")).toEqual([
      "Tokens",
      "Cloudflare",
      "Worker",
      "endpoint",
    ]);
    expect(words("Patched a vulnerability (CVE) and an exploit.")).toEqual([
      "vulnerability",
      "CVE",
      "exploit",
    ]);
    expect(words("The delete-account flow and moduo-mcp are faster.")).toEqual([
      "delete-account",
      "moduo-mcp",
    ]);

    expect(words("Timers save every 3-minute block and work over Wi-Fi.")).toEqual([]);
    expect(words("Rewrote the SQL in Postgres behind an edge function as service role.")).toEqual([
      "SQL",
      "Postgres",
      "edge function",
      "service role",
    ]);
    expect(words("Shipped in #475 at commit 3688d318.")).toEqual(["#475", "3688d318"]);

    // The reason is named with the word, so the error says what to fix.
    const [leak] = findLeaks("The booking-public page loads faster.", deny);
    expect(leak).toEqual({ word: "booking-public", reason: "Edge Function name" });
  });

  it("deny-list comes from the codebase", () => {
    // Read from this repo's supabase/ folder at run time.
    expect(deny.get("delete-account")).toBe("Edge Function name");
    expect(deny.get("moduo-mcp")).toBe("Edge Function name");
    expect([...deny.values()]).toContain("table name");
    expect([...deny.values()]).toContain("SQL function name");
    // A single plain word is product vocabulary, never denied.
    expect(deny.has("tasks")).toBe(false);

    // A new table, function or Edge Function is covered without editing the check.
    const root = tempRepo({
      "supabase/migrations/20990101000000_new.sql":
        'create table if not exists public.Mood_Logs (id uuid);\ncreate or replace function private."score_mood"() returns int as $$ select 1 $$ language sql;\ncreate view mood_summary as select 1;',
      "supabase/functions/mood-sync/index.ts": "",
      "supabase/functions/_shared/x.ts": "",
    });
    const fresh = buildDenyList(root);
    expect(Object.fromEntries(fresh)).toEqual({
      mood_logs: "table name",
      score_mood: "SQL function name",
      mood_summary: "table name",
      "mood-sync": "Edge Function name",
    });
    expect(findLeaks("Mood-Sync is quicker now.", fresh)).toEqual([
      { word: "Mood-Sync", reason: "Edge Function name" },
    ]);
  });

  it("security type is the fixed line", () => {
    expect(shapeProblems(SECURITY_LINE, "security")).toEqual([]);
    expect(shapeProblems("Fixed a sign-in issue.", "security")).toEqual([
      `a security note must be exactly "${SECURITY_LINE}"`,
    ]);
    expect(shapeProblems("Security and reliability improvements", "security")).toHaveLength(1);
  });

  it("keeps notes short: one or two sentences, 200 characters", () => {
    expect(shapeProblems("One. Two.", "new")).toEqual([]);
    expect(shapeProblems("Works with lists, e.g. tasks. Faster too.", "new")).toEqual([]);
    expect(shapeProblems("One. Two. Three.", "new")).toEqual(["has 3 sentences (one or two)"]);
    expect(shapeProblems("No full stop", "fixed")).toEqual(["must end a sentence with . ! or ?"]);
    expect(shapeProblems(`${"a".repeat(200)}.`, "fixed")).toEqual([
      "is 201 characters (at most 200)",
    ]);
  });

  it("parses the front matter strictly", () => {
    expect(parseNote("snooze", note("new", "Snooze is here.", "highlight: true\n"))).toEqual({
      slug: "snooze",
      type: "new",
      internal: false,
      highlight: true,
      text: "Snooze is here.",
    });
    // Comments after a value, as in the README template, are ignored.
    expect(
      parseNote("x", "---\ntype: fixed  # new | improved\ninternal: false # shown\n---\nHi.\n")
        .type,
    ).toBe("fixed");
    expect(() => parseNote("x", "Just text.")).toThrow(/front matter/);
    expect(() => parseNote("x", note("feature", "Hi."))).toThrow(/type must be one of/);
    expect(() => parseNote("x", "---\ntype: new\n---\nHi.\n")).toThrow(/internal: true/);
    expect(() => parseNote("x", note("new", "Hi.", "audience: all\n"))).toThrow(/unknown/);
    expect(() => parseNote("x", note("new", ""))).toThrow(/no text/);
  });

  it("checks pending notes and releases.json, skips internal notes", () => {
    const root = tempRepo({
      "supabase/functions/mood-sync/index.ts": "",
      ".changes/README.md": "# not a note",
      ".changes/good.md": note("fixed", "Moods save reliably again."),
      ".changes/internal.md": "---\ntype: improved\ninternal: true\n---\nRefactored mood-sync.\n",
      ".changes/leaky.md": note("improved", "The mood-sync job is faster."),
      ".changes/bad-security.md": note("security", "Patched the login form."),
      "release-notes/releases.json": JSON.stringify({
        releases: [
          {
            version: "1.0.0",
            date: "2026-10-01",
            highlights: [],
            items: [{ type: "new", text: "Added `moods`." }],
          },
        ],
      }),
    });
    expect(checkRepo(root)).toEqual([
      `.changes/bad-security.md: a security note must be exactly "${SECURITY_LINE}"`,
      '.changes/leaky.md: leaks internal words: "mood-sync" (Edge Function name)',
      'release-notes/releases.json 1.0.0: "Added `moods`." leaks internal words: "`" (backtick (code formatting))',
    ]);
  });

  it("passes the committed notes and releases.json", () => {
    expect(checkRepo()).toEqual([]);
  });
});
