#!/usr/bin/env node
// Compare two lab runs: measured deltas only (gates, feel rows, token conformance, journey
// input cost, axe rules), as a Markdown table for a PR body. No critic involved: before and
// after builds are close pairs, where a model's holistic verdict is close to chance.
//   node delta.mjs <old-run-dir> <new-run-dir>
import path from "node:path";

import { readJson } from "./lib/util.mjs";

const [a, b] = process.argv.slice(2).map((p) => path.resolve(p));
if (!a || !b) {
  process.stderr.write("usage: node delta.mjs <old-run-dir> <new-run-dir>\n");
  process.exit(2);
}
const load = (dir) => ({
  gates: readJson(path.join(dir, "gates.json"), { areas: {}, hardFails: [] }),
  feel: readJson(path.join(dir, "feel.json"), []),
  tokens: readJson(path.join(dir, "tokens.json")),
  journeys: readJson(path.join(dir, "journeys", "index.json"), []),
  a11y: readJson(path.join(dir, "a11y.json"), []),
});
const A = load(a);
const B = load(b);
const fmt = (v) => (v == null ? "-" : String(v));
const arrow = (x, y, lowerIsBetter = false) => {
  if (x == null || y == null || x === y) return "";
  const better = lowerIsBetter ? y < x : y > x;
  return better ? " ✓" : " ✗";
};
const out = [`### Lab delta: ${path.basename(a)} → ${path.basename(b)}`, "", "| Measure | Before | After |", "|---|---|---|"];
for (const k of new Set([...Object.keys(A.gates.areas), ...Object.keys(B.gates.areas)])) {
  const x = A.gates.areas[k]?.score ?? null;
  const y = B.gates.areas[k]?.score ?? null;
  out.push(`| gate: ${k} | ${fmt(x)} | ${fmt(y)}${arrow(x, y)} |`);
}
out.push(`| hard fails | ${A.gates.hardFails.length} | ${B.gates.hardFails.length}${arrow(A.gates.hardFails.length, B.gates.hardFails.length, true)} |`);
out.push(`| token conformance | ${fmt(A.tokens?.overall)} | ${fmt(B.tokens?.overall)}${arrow(A.tokens?.overall, B.tokens?.overall)} |`);
for (const row of B.feel) {
  const old = A.feel.find((r) => r.id === row.id);
  if (row.value == null && old?.value == null) continue;
  out.push(`| feel ${row.id}: ${row.interaction} | ${fmt(old?.value)} ${old?.band ?? ""} | ${fmt(row.value)} ${row.band ?? ""}${arrow(old?.value, row.value, true)} |`);
}
for (const j of B.journeys) {
  const old = A.journeys.find((x) => x.id === j.id && x.mode === j.mode);
  if (!old) continue;
  const ca = old.counts.keys + old.counts.clicks;
  const cb = j.counts.keys + j.counts.clicks;
  if (ca !== cb || old.completed !== j.completed) out.push(`| journey ${j.id} (${j.mode}) inputs | ${ca}${old.completed ? "" : " (failed)"} | ${cb}${j.completed ? "" : " (failed)"}${arrow(ca, cb, true)} |`);
}
const rules = (list) => new Set(list.flatMap((s) => (s.axe?.violations ?? []).filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id)));
const ra = rules(A.a11y);
const rb = rules(B.a11y);
const fixed = [...ra].filter((r) => !rb.has(r));
const added = [...rb].filter((r) => !ra.has(r));
out.push("");
if (fixed.length) out.push(`Serious axe rules fixed: ${fixed.join(", ")}`);
if (added.length) out.push(`Serious axe rules introduced: ${added.join(", ")}`);
const ta = new Set((A.tokens?.top ?? []).map((t) => `${t.prop} ${t.value}`));
const tb = new Set((B.tokens?.top ?? []).map((t) => `${t.prop} ${t.value}`));
const gone = [...ta].filter((t) => !tb.has(t));
const newer = [...tb].filter((t) => !ta.has(t));
if (gone.length) out.push(`Drift values gone: ${gone.join("; ")}`);
if (newer.length) out.push(`Drift values new: ${newer.join("; ")}`);
process.stdout.write(`${out.join("\n")}\n`);
