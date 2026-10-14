// DRAFT (CV-0 spike 4) — the conversion check CV-1 reruns.
// Input: JSON files of [{ id, v1, v2 }] where v2 = chat__v1_to_v2(v1), exported
// with psql (see docs/build/chat-v2/CV-0-S4.md §Converter run). For each row:
// v2 parses (how many are already canonical; re-saving settles), no v1 token or entity
// label is left, and v2 draws what v1 drew; rows that differ are listed with
// the accepted Markdown changes counted on their own.
//
//   bun docs/build/chat-v2/drafts/check_v1_to_v2.ts research.json fixture.json

import { readFileSync } from "node:fs";

import { parseStored } from "../../../../src/features/chat/markup-v2/parse";
import { serializeBlocks } from "../../../../src/features/chat/markup-v2/serialize";
import { compareConversion } from "../../../../src/features/chat/markup-v2/v1-compare";

type Row = { id: string; v1: string; v2: string };

for (const file of process.argv.slice(2)) {
  const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];
  const counts = {
    rows: rows.length,
    changedText: 0,
    /** The converted text is already what the serializer writes (editing it changes nothing). */
    canonicalText: 0,
    /** Re-saving once settles: serialize(parse(·)) of the converted text is a fixed point. */
    settlesInOne: 0,
    tokenLeft: 0,
    labelLeft: 0,
    sameDrawing: 0,
    differentDrawing: 0,
    lines: {} as Record<string, number>,
  };
  const different: string[] = [];
  for (const row of rows) {
    if (row.v1 !== row.v2) counts.changedText += 1;
    const once = serializeBlocks(parseStored(row.v2));
    if (once === row.v2) counts.canonicalText += 1;
    if (serializeBlocks(parseStored(once)) === once) counts.settlesInOne += 1;
    const c = compareConversion(row.v1, row.v2);
    if (c.tokenLeft) counts.tokenLeft += 1;
    if (c.labelLeft) counts.labelLeft += 1;
    for (const kind of c.lines) counts.lines[kind] = (counts.lines[kind] ?? 0) + 1;
    if (c.same) counts.sameDrawing += 1;
    else {
      counts.differentDrawing += 1;
      different.push(
        `${row.id}: ${JSON.stringify(row.v1)} → ${JSON.stringify(row.v2)} [${c.lines.join(", ")}]`,
      );
    }
  }
  console.log(`\n# ${file}`);
  console.log(JSON.stringify(counts, null, 2));
  if (different.length) console.log(`drawn differently:\n${different.join("\n")}`);
}
