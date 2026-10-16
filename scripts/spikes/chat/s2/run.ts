// CV-0 spike 2: the chat store and its device copy. One runner for every
// pass bar (round-3 §5 spike 2; record: docs/build/chat-v2/CV-0-S2.md).
//
//   bun scripts/spikes/chat/s2/run.ts [sql] [browser] [access] [--webkit | --webkit-only] [--keep]
//
//   sql      bar 3: delta = full read after 1,000 missed changes; keyset pages
//            over a 200-message tie, both directions (scratch schema spike_s2)
//   browser  bars 1, 2, 4, 6: cold open, one 500-row transaction, heap with
//            1,500 in memory, layouts and the Tasks-style whole record, in a
//            real Chromium through Playwright (and WebKit with --webkit)
//   access   bar 5: losing access without an event, chat_sync_ids → the store
//            → IndexedDB, in Chromium
//
// With no phase it runs all three. Results go to $TMPDIR/moduo-spike-s2/; the
// schema spike_s2 is dropped at the end unless --keep. Local stack only.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, dropSchema, freshSchema } from "./db";
import { proveDelta, proveKeyset } from "./sql-proof";

const args = new Set(process.argv.slice(2));
const phases = ["sql", "browser", "access"].filter((p) => args.has(p));
const run = phases.length > 0 ? phases : ["sql", "browser", "access"];
const outDir = join(process.env.TMPDIR ?? tmpdir(), "moduo-spike-s2");
mkdirSync(outDir, { recursive: true });

const results: Record<string, unknown> = { at: new Date().toISOString() };
const sql = connect();
try {
  if (run.includes("sql")) {
    freshSchema();
    results.delta = await proveDelta(sql);
    freshSchema();
    results.keyset = await proveKeyset(sql);
    report("bar 3a delta = full", results.delta);
    report("bar 3b keyset", results.keyset);
  }
  if (run.includes("browser")) {
    const { runBrowserBench } = await import("./browser-bench");
    results.browser = await runBrowserBench({
      outDir,
      webkit: args.has("--webkit"),
      webkitOnly: args.has("--webkit-only"),
    });
    report("bars 1, 2, 4, 6 browser", results.browser);
  }
  if (run.includes("access")) {
    const { proveAccess } = await import("./access-proof");
    freshSchema();
    results.access = await proveAccess(sql, outDir);
    report("bar 5 access", results.access);
  }
} finally {
  await sql.close();
  if (!args.has("--keep")) dropSchema();
  const file = join(outDir, `results-${run.join("-")}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\nfull results: ${file}`);
}

function report(name: string, value: unknown): void {
  const v = value as { pass?: boolean };
  console.log(`\n== ${name}: ${v.pass === undefined ? "see results" : v.pass ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(value, null, 1).slice(0, 6000));
}
