// Print the spike's results as compact lines (p50 / p95 / max per metric).
//   bun scripts/spikes/chat/s2/summary.ts [results.json …]

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Stat = { p50: number; p95: number; max: number; n: number };
const dir = join(process.env.TMPDIR ?? tmpdir(), "moduo-spike-s2");
const files = process.argv.slice(2);
if (files.length === 0) files.push(join(dir, "results-browser.json"));

const isStat = (v: unknown): v is Stat =>
  typeof v === "object" && v !== null && "p50" in v && "p95" in v;

function line(name: string, v: Record<string, unknown>): string {
  const parts = Object.entries(v)
    .filter(([, x]) => isStat(x))
    .map(([k, x]) => `${k} ${(x as Stat).p50}/${(x as Stat).p95}/${(x as Stat).max}`);
  return `  ${name}: ${parts.join(" · ")}`;
}

for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const r = (raw.browser ?? raw) as Record<string, unknown>;
  console.log(`# ${file}`);
  for (const engine of ["chromium", "webkit"]) {
    const e = r[engine] as Record<string, Record<string, Record<string, unknown>>> | undefined;
    if (!e) continue;
    console.log(`${engine}: ${String(e.userAgent ?? e.error ?? "").slice(0, 110)}`);
    for (const section of ["coldRelaunch", "coldReload", "write"]) {
      if (!e[section]) continue;
      console.log(`${section} (p50/p95/max ms)`);
      for (const [name, v] of Object.entries(e[section])) console.log(line(name, v));
    }
    for (const k of ["seeded", "storage", "heap"])
      if (e[k]) console.log(`${k}:`, JSON.stringify(e[k]));
  }
  if (r.bars) console.log("bars:", JSON.stringify(r.bars), "pass:", r.pass);
}
