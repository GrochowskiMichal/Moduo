import { createHeadlessEditor } from "@lexical/headless";
import { describe, expect, it } from "@rstest/core";

import { canonicalBlocks } from "./canonical";
import {
  $editorToBlocks,
  $exportStored,
  $importBlocks,
  $importStored,
  CHAT_EDITOR_NODES,
} from "./lexical";
import { parseStored } from "./parse";
import { serializeBlocks } from "./serialize";
import type { Block, CodeLeaf, Inline, TextLeaf } from "./types";

// A seeded generator of random trees: every mark combination, every leaf kind,
// text drawn from the characters that are syntax somewhere. Each canonical tree
// must serialize to text that parses back to itself, and that text must be a
// fixed point. Seeded, so a failure reproduces.

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "a",
  "b",
  "word",
  " ",
  "  ",
  "\t",
  "*",
  "**",
  "_",
  "__",
  "~",
  "~~",
  "`",
  "``",
  "[",
  "]",
  "(",
  ")",
  "\\",
  "<",
  ">",
  "<b>",
  "-",
  "+",
  "1.",
  "2)",
  "#",
  "=",
  "!",
  ":",
  "::",
  ":ok:",
  ":ship_it:",
  "10:30:45",
  "@channel",
  "@channels",
  "x@channel",
  "https://x.com/a_(b)",
  "https://moduo.app/t?q=1&b=[2]",
  "moduo://",
  "moduo://task/",
  "ż",
  "zażółć",
  "gęślą",
  "jaźń",
  "👍",
  "👩🏽‍💻",
  "🇵🇱",
  ".",
  ",",
  "|",
  "&amp;",
  "'",
  '"',
];

const UUIDS = ["11111111-1111-4111-8111-111111111111", "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d"];
const TYPES = [
  "task",
  "note",
  "person",
  "team",
  "chat_channel",
  "chat_message",
  "bucket",
  "email_thread",
];

function gen(seed: number): Block[] {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const text = () => {
    let s = "";
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) s += pick(PIECES);
    return s;
  };
  const marks = () => Math.floor(r() * 8);
  const leaf = (inLink = false): Inline => {
    const roll = r();
    if (inLink || roll < 0.55) return { t: "text", v: text(), m: marks() };
    if (roll < 0.68) return { t: "code", v: text(), m: marks() };
    if (roll < 0.76) return { t: "ref", type: pick(TYPES), id: pick(UUIDS) };
    if (roll < 0.8) return { t: "date", day: "2026-10-17" };
    if (roll < 0.86) {
      const c: Array<TextLeaf | CodeLeaf> = [];
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        c.push(
          r() < 0.8 ? { t: "text", v: text(), m: marks() } : { t: "code", v: text(), m: marks() },
        );
      }
      return {
        t: "link",
        href: pick(["https://x.com/a b", "https://x.com/(1)", "mailto:a@b.co", "https://x.y/a\\b"]),
        c,
      };
    }
    return { t: "br" };
  };
  const inline = () => {
    const out: Inline[] = [];
    const n = 1 + Math.floor(r() * 8);
    for (let i = 0; i < n; i++) out.push(leaf());
    return out;
  };
  const blocks: Block[] = [];
  const nb = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nb; i++) {
    const roll = r();
    if (roll < 0.5) blocks.push({ t: "p", c: inline() });
    else if (roll < 0.65) blocks.push({ t: "quote", c: inline() });
    else if (roll < 0.75)
      blocks.push({
        t: "pre",
        v: `${text()}\n${text()}`.replace(/\n+$/, ""),
        lang: pick([null, "ts", "c++"]),
      });
    else {
      const items: Inline[][] = [];
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) items.push(inline());
      blocks.push({ t: "list", ordered: r() < 0.5, start: pick([1, 3, 9, 10]), items });
    }
  }
  return blocks;
}

function headless() {
  return createHeadlessEditor({
    namespace: "chat-fuzz",
    nodes: [...CHAT_EDITOR_NODES],
    onError: (error) => {
      throw error;
    },
  });
}

describe("emphasis, exhaustively", () => {
  // Every sequence of up to N leaves, each text or inline code with any of the
  // 8 mark sets: the emphasis stack must read back exactly what was written.
  // N = 3 is 4,368 sequences; CHAT_EXHAUSTIVE_DEPTH=4 runs 69,904.
  it("every mark sequence round-trips", () => {
    const depth = Number(process.env.CHAT_EXHAUSTIVE_DEPTH ?? 3);
    const failures: string[] = [];
    let total = 0;
    const walk = (prefix: Inline[]) => {
      if (prefix.length > 0) {
        total += 1;
        const tree = canonicalBlocks([{ t: "p", c: prefix }]);
        const stored = serializeBlocks(tree);
        if (JSON.stringify(parseStored(stored)) !== JSON.stringify(tree)) failures.push(stored);
      }
      if (prefix.length === depth) return;
      for (let m = 0; m < 8; m++) {
        for (const t of ["text", "code"] as const) {
          walk([...prefix, { t, v: "abcd"[prefix.length] as string, m }]);
        }
      }
    };
    walk([]);
    expect(total).toBe(depth === 3 ? 4368 : total);
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe("stored form fuzz", () => {
  it("every canonical tree survives the editor: import → export → parse → import", () => {
    const failures: string[] = [];
    const RUNS = Number(process.env.CHAT_FUZZ_LEXICAL_RUNS ?? 1500);
    for (let seed = 1; seed <= RUNS; seed++) {
      const tree = canonicalBlocks(gen(seed));
      const stored = serializeBlocks(tree);
      const a = headless();
      a.update(() => $importBlocks(tree), { discrete: true });
      const exported = a.read(() => $exportStored());
      const back = a.read(() => $editorToBlocks());
      const b = headless();
      b.update(() => $importStored(exported), { discrete: true });
      const same =
        exported === stored &&
        JSON.stringify(back) === JSON.stringify(tree) &&
        JSON.stringify(b.getEditorState().toJSON()) === JSON.stringify(a.getEditorState().toJSON());
      if (!same) {
        if (failures.length < 3) {
          failures.push(
            `seed ${seed}\nstored:   ${JSON.stringify(stored)}\nexported: ${JSON.stringify(exported)}\ntree: ${JSON.stringify(tree)}\nback: ${JSON.stringify(back)}`,
          );
        } else failures.push(`seed ${seed}`);
      }
    }
    expect(`${failures.slice(0, 3).join("\n\n")}\n(${failures.length} of ${RUNS} failed)`).toBe(
      `\n(0 of ${RUNS} failed)`,
    );
  });

  it("every canonical tree survives serialize → parse, and the text is a fixed point", () => {
    const failures: string[] = [];
    const RUNS = Number(process.env.CHAT_FUZZ_RUNS ?? 3000);
    for (let seed = 1; seed <= RUNS; seed++) {
      const tree = canonicalBlocks(gen(seed));
      const stored = serializeBlocks(tree);
      const back = parseStored(stored);
      const again = serializeBlocks(back);
      if (JSON.stringify(back) !== JSON.stringify(tree) || again !== stored) {
        if (failures.length < 5) {
          failures.push(
            `seed ${seed}\nstored: ${JSON.stringify(stored)}\ntree:   ${JSON.stringify(tree)}\nback:   ${JSON.stringify(back)}`,
          );
        } else failures.push(`seed ${seed}`);
      }
    }
    expect(`${failures.slice(0, 5).join("\n\n")}\n(${failures.length} of ${RUNS} failed)`).toBe(
      `\n(0 of ${RUNS} failed)`,
    );
  });
});
