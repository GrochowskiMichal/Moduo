// CV-0 spike 1: print the results as one line per engine × library × config ×
// scenario (the record's tables are built from this).
//   bun scripts/spikes/chat/s1/summary.ts [engine…]

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Result = {
  scenario: string;
  config: string;
  pass: boolean | null;
  metrics: Record<string, unknown>;
  note?: string;
};
type Doc = {
  engine: string;
  libs: Record<string, { at: string; fingerprint: Record<string, unknown>; results: Result[] }>;
};

const dir = fileURLToPath(new URL("./results", import.meta.url));
const only = process.argv.slice(2);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const doc = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as Doc;
  if (only.length && !only.includes(doc.engine)) continue;
  for (const [lib, run] of Object.entries(doc.libs)) {
    console.log(`\n## ${doc.engine} · ${lib} · ${run.at}`);
    console.log(`   ${run.fingerprint.userAgent}`);
    for (const r of run.results) {
      const mark = r.pass === null ? "  ·  " : r.pass ? " PASS" : " FAIL";
      const m = JSON.stringify(r.metrics)
        .replace(/"([a-zA-Z0-9.-]+)":/g, "$1=")
        .replace(/[{}"]/g, "");
      console.log(
        `${mark} ${r.config.padEnd(22)} ${r.scenario.padEnd(26)} ${m}${r.note ? ` ‹${r.note}›` : ""}`,
      );
    }
  }
}
