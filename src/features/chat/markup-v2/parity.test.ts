import { createHeadlessEditor } from "@lexical/headless";
import { describe, expect, it } from "@rstest/core";
import { $getRoot, type LexicalEditor } from "lexical";

import { canonicalBlocks } from "./canonical";
import { EDITOR_CASES, PASTE_CASES, STORED_CASES } from "./corpus";
import {
  $blocksToNodes,
  $canonicalizeEditor,
  $editorToBlocks,
  $exportStored,
  $importBlocks,
  $importStored,
  CHAT_EDITOR_NODES,
} from "./lexical";
import { parseStored } from "./parse";
import { htmlToBlocks } from "./paste";
import { serializeBlocks } from "./serialize";

// Spike 4's parity bar (round-3 §5): editor → stored → parser → editor, 100 %.
// For every case: the editor exports the expected stored text; that text parses
// to the editor's own tree and serializes back to itself; and a fresh editor
// importing it holds the same nodes (or, for the `canonical` cases, the
// canonical form of what the first editor held, which differs on purpose).

function editor(): LexicalEditor {
  return createHeadlessEditor({
    namespace: "chat-parity",
    nodes: [...CHAT_EDITOR_NODES],
    onError: (error) => {
      throw error;
    },
  });
}

const json = (e: LexicalEditor) => JSON.stringify(e.getEditorState().toJSON());

type Outcome = { exported: string; problems: string[]; changed: boolean };

/** Run one editor through the round trip. */
function roundTrip(a: LexicalEditor): Outcome {
  const problems: string[] = [];
  const exported = a.read(() => $exportStored());
  const tree = a.read(() => $editorToBlocks());
  const parsed = parseStored(exported);
  if (JSON.stringify(parsed) !== JSON.stringify(tree)) problems.push("parse(stored) ≠ editor tree");
  if (serializeBlocks(parsed) !== exported) problems.push("stored text is not a fixed point");
  if (JSON.stringify(canonicalBlocks(parsed)) !== JSON.stringify(parsed)) {
    problems.push("parsed tree is not canonical");
  }
  const b = editor();
  b.update(() => $importStored(exported), { discrete: true });
  const canon = editor();
  canon.update(() => $importBlocks(tree), { discrete: true });
  if (json(b) !== json(canon)) problems.push("import(stored) ≠ canonical editor");
  if (b.read(() => $exportStored()) !== exported) problems.push("re-export differs");
  return { exported, problems, changed: json(b) !== json(a) };
}

describe("stored form parity: the corpus", () => {
  it(`has 200+ editor and paste cases`, () => {
    expect(EDITOR_CASES.length + PASTE_CASES.length).toBeGreaterThanOrEqual(200);
    const names = new Set([...EDITOR_CASES, ...PASTE_CASES].map((c) => c.name));
    expect(names.size).toBe(EDITOR_CASES.length + PASTE_CASES.length);
  });

  it("every editor case: exports as written, comes back node for node (or canonical where marked)", () => {
    const report: string[] = [];
    for (const c of EDITOR_CASES) {
      const a = editor();
      a.update(
        () => {
          $getRoot().clear();
          $getRoot().append(...c.doc.map((build) => build()));
        },
        { discrete: true },
      );
      const out = roundTrip(a);
      if (out.exported !== c.stored) {
        report.push(
          `${c.name}: exported ${JSON.stringify(out.exported)} expected ${JSON.stringify(c.stored)}`,
        );
      }
      for (const p of out.problems) report.push(`${c.name}: ${p}`);
      if (out.changed !== Boolean(c.canonical)) {
        report.push(
          `${c.name}: ${out.changed ? "changed by the round trip (mark canonical?)" : "unchanged but marked canonical"}`,
        );
      }
    }
    expect(report.join("\n")).toBe("");
  });

  it("every paste case: Slack and Google Docs HTML through the clean paste, then the round trip", () => {
    const report: string[] = [];
    for (const c of PASTE_CASES) {
      const a = editor();
      a.update(
        () => {
          $getRoot().clear();
          const nodes = $blocksToNodes(htmlToBlocks(c.html));
          if (nodes.length) $getRoot().append(...nodes);
        },
        { discrete: true },
      );
      const out = roundTrip(a);
      if (out.exported !== c.stored) {
        report.push(
          `${c.name}: exported ${JSON.stringify(out.exported)} expected ${JSON.stringify(c.stored)}`,
        );
      }
      for (const p of out.problems) report.push(`${c.name}: ${p}`);
      if (out.changed) report.push(`${c.name}: a paste must already be canonical`);
    }
    expect(report.join("\n")).toBe("");
  });

  it("stored text written elsewhere reads leniently and settles in one step", () => {
    const report: string[] = [];
    for (const c of STORED_CASES) {
      const once = serializeBlocks(parseStored(c.input));
      if (once !== c.canonical) {
        report.push(`${c.name}: ${JSON.stringify(once)} expected ${JSON.stringify(c.canonical)}`);
      }
      if (serializeBlocks(parseStored(once)) !== once) report.push(`${c.name}: not settled`);
      const e = editor();
      e.update(() => $importStored(c.input), { discrete: true });
      if (e.read(() => $exportStored()) !== once) report.push(`${c.name}: editor export differs`);
      e.update(() => $canonicalizeEditor(), { discrete: true });
    }
    expect(report.join("\n")).toBe("");
  });
});
