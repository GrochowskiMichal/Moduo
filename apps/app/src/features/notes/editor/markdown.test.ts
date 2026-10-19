/**
 * AC11 — markdown round-trip: md → blocks → md is stable for headings, lists,
 * checkboxes, chips and page-rows; unknown syntax degrades to text, never
 * throws. Runs in a headless Lexical editor (no DOM render — decorators are
 * never mounted).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  $convertFromMarkdownString,
  $convertSelectionToMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { describe, expect, it } from "@rstest/core";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $selectAll,
  $setSelection,
} from "lexical";
import * as Y from "yjs";
import { decodeBase64ToUint8 } from "../utils/base64";
import {
  createNotesHeadlessEditor,
  deriveNoteBody,
  extractTaskLineIds,
  NOTES_DOC_ROOT,
} from "./doc-markdown";
import { FIDELITY_MD } from "./fidelity.fixture";
import {
  HR_TRANSFORMER,
  looksLikeMarkdown,
  NOTES_TRANSFORMERS,
  TABLE_TRANSFORMER,
} from "./markdown";
import { buildDocStateFromMarkdown } from "./materialize";
import { $isPartialWithinOneBlock } from "./plugins/markdown-clipboard-plugin";

/** The REAL node set (the live editor's), so these tests can't pass against a
 * registration the app doesn't have. */
function makeEditor() {
  const { editor } = createNotesHeadlessEditor("md-test");
  return editor;
}

function roundTrip(md: string): string {
  const editor = makeEditor();
  editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), {
    discrete: true,
  });
  let out = "";
  editor.read(() => {
    out = $convertToMarkdownString(NOTES_TRANSFORMERS);
  });
  return out;
}

function $getSelectionOrThrow() {
  const sel = $getSelection();
  if (!sel) throw new Error("no selection");
  return sel;
}

describe("markdown round-trip (AC11)", () => {
  it("headings, paragraphs, lists and checkboxes are byte-stable", () => {
    const md = [
      "# Plan",
      "",
      "Some intro text.",
      "",
      "## Steps",
      "",
      "- first",
      "- second",
      "",
      "1. one",
      "2. two",
      "",
      "- [x] done thing",
      "- [ ] open thing",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
  });

  it("checkboxes import as REAL check-list items, not literal-text bullets", () => {
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString("- [x] done\n- [ ] open", NOTES_TRANSFORMERS), {
      discrete: true,
    });
    editor.read(() => {
      const json = JSON.stringify(editor.getEditorState().toJSON());
      expect(json).toContain('"listType":"check"');
      expect(json).not.toContain("[x]"); // no literal marker text survives
    });
  });

  it("entity chips survive: [label](moduo://type/id)", () => {
    const md = "Talked to [Jane Doe](moduo://contact/abc-123) about the deal.";
    const out = roundTrip(md);
    expect(out).toBe(md);
  });

  it("task lines round-trip: `- [ ] title <!-- moduo:task:id -->` (NO-5 AC3/AC11)", () => {
    const md = [
      "- [ ] Ship the report <!-- moduo:task:task-123 -->",
      "",
      "- [x] Email Anna <!-- moduo:task:task-456 -->",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
  });

  it("a task line imports as a REAL task-line block carrying the id — never a checklist item", () => {
    const editor = makeEditor();
    editor.update(
      () =>
        $convertFromMarkdownString("- [x] Ship it <!-- moduo:task:task-9 -->", NOTES_TRANSFORMERS),
      { discrete: true },
    );
    editor.read(() => {
      const json = JSON.stringify(editor.getEditorState().toJSON());
      expect(json).toContain('"type":"task-line"');
      expect(json).toContain('"taskId":"task-9"');
      expect(json).toContain('"done":true');
      expect(json).not.toContain("moduo:task"); // comment stripped from the text
      expect(json).not.toContain('"listType":"check"');
    });
  });

  it("a plain checkbox WITHOUT the id comment stays a humble checklist item (checkboxes never mint)", () => {
    const editor = makeEditor();
    editor.update(
      () => $convertFromMarkdownString("- [ ] shopping list item", NOTES_TRANSFORMERS),
      { discrete: true },
    );
    editor.read(() => {
      const json = JSON.stringify(editor.getEditorState().toJSON());
      expect(json).toContain('"listType":"check"');
      expect(json).not.toContain('"type":"task-line"');
    });
  });

  it("a standalone note link becomes a PAGE-ROW block (and exports back)", () => {
    const md = "[Kickoff notes](moduo://note/n-1)";
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
    let types: string[] = [];
    let out = "";
    editor.read(() => {
      types = $getRoot()
        .getChildren()
        .map((n) => n.getType());
      out = $convertToMarkdownString(NOTES_TRANSFORMERS);
    });
    expect(types).toEqual(["page-row"]);
    expect(out).toBe(md);
  });

  it("an INLINE note link inside a sentence stays a chip, not a page-row", () => {
    const md = "See [Kickoff notes](moduo://note/n-1) for context.";
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
    let types: string[] = [];
    editor.read(() => {
      types = $getRoot()
        .getChildren()
        .map((n) => n.getType());
    });
    expect(types).toEqual(["paragraph"]);
    expect(roundTrip(md)).toBe(md);
  });

  it("mindmap embeds and dividers round-trip", () => {
    expect(roundTrip("[Mindmap](moduo://mindmap/m-9)")).toBe("[Mindmap](moduo://mindmap/m-9)");
    expect(roundTrip("above\n\n---\n\nbelow")).toBe("above\n\n---\n\nbelow");
  });

  it("a regular web link is NOT a chip", () => {
    const md = "See [docs](https://example.com) here.";
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
    let hasChip = false;
    editor.read(() => {
      hasChip = JSON.stringify(editor.getEditorState().toJSON()).includes("entity-ref");
    });
    expect(hasChip).toBe(false);
  });

  it("unknown syntax degrades to plain text — never throws", () => {
    const weird = "::: custom-directive\n{{ handlebars }}\n[[wiki-link]]\n%%% chaos";
    expect(() => roundTrip(weird)).not.toThrow();
    const out = roundTrip(weird);
    expect(out).toContain("custom-directive");
    expect(out).toContain("wiki-link");
  });
});

describe("looksLikeMarkdown (the paste heuristic)", () => {
  it("accepts block syntax", () => {
    expect(looksLikeMarkdown("# Title\n\nbody")).toBe(true);
    expect(looksLikeMarkdown("- a\n- b")).toBe(true);
    expect(looksLikeMarkdown("1. one\n2. two")).toBe(true);
    expect(looksLikeMarkdown("> quoted\nline")).toBe(true);
    expect(looksLikeMarkdown("```\ncode\n```")).toBe(true);
    expect(looksLikeMarkdown("- [ ] open\n- [x] done")).toBe(true);
  });

  it("rejects prose, URLs and single lines", () => {
    expect(looksLikeMarkdown("just a sentence")).toBe(false);
    expect(looksLikeMarkdown("https://example.com/a-b#c")).toBe(false);
    expect(looksLikeMarkdown("two plain\nlines of prose")).toBe(false);
  });
});

describe("copy: selection → markdown through the same transformers (NR-3)", () => {
  function load(md: string) {
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
    return editor;
  }

  it("a whole-document selection copies exactly what export writes", () => {
    const md = [
      "## Notes",
      "",
      "Ping [Jane](moduo://contact/c1) re **pricing**",
      "",
      "- [x] sent",
      "- [ ] follow up",
      "",
      "- [x] Ship it <!-- moduo:task:task-1 -->",
      "",
      "[Child page](moduo://note/n2)",
    ].join("\n");
    const editor = load(md);
    let copied = "";
    editor.update(
      () => {
        $selectAll();
        copied = $convertSelectionToMarkdownString(NOTES_TRANSFORMERS, $getSelectionOrThrow());
      },
      { discrete: true },
    );
    expect(copied.trim()).toBe(md);
  });

  it("a partial inline range copies only the selected words, marks kept", () => {
    const editor = load("Ping **pricing** today");
    let copied = "";
    editor.update(
      () => {
        const texts = $getRoot().getAllTextNodes();
        const bold = texts.find((t) => t.getTextContent() === "pricing")!;
        const sel = $createRangeSelection();
        sel.anchor.set(bold.getKey(), 0, "text");
        sel.focus.set(bold.getKey(), 7, "text");
        $setSelection(sel);
        copied = $convertSelectionToMarkdownString(NOTES_TRANSFORMERS, sel);
      },
      { discrete: true },
    );
    expect(copied.trim()).toBe("**pricing**");
  });
});

function docFrom(md: string): Y.Doc {
  const built = buildDocStateFromMarkdown("note-fidelity", md)!;
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(doc, decodeBase64ToUint8(built.docStateB64));
  return doc;
}

describe("single dialect (NR-3, AC9)", () => {
  it("markdown → editor → markdown is byte-stable for every listed construct", () => {
    expect(roundTrip(FIDELITY_MD)).toBe(FIDELITY_MD);
  });

  it("the derived body_md survives the CRDT: markdown → Yjs doc → body_md is byte-identical", () => {
    expect(deriveNoteBody(docFrom(FIDELITY_MD)).md).toBe(FIDELITY_MD);
  });

  it("deriving twice is stable (no drift on every push)", () => {
    const once = deriveNoteBody(docFrom(FIDELITY_MD)).md;
    expect(deriveNoteBody(docFrom(once)).md).toBe(once);
  });

  it("tables import as REAL table blocks with a header row", () => {
    const editor = makeEditor();
    editor.update(
      () => $convertFromMarkdownString("| a | b |\n| --- | --- |\n| 1 | 2 |", NOTES_TRANSFORMERS),
      { discrete: true },
    );
    const json = JSON.stringify(editor.getEditorState().toJSON());
    expect(json).toContain('"type":"table"');
    expect(json).toContain('"headerState":1');
    expect(json).not.toContain("| a |");
  });

  it("a pipe inside a cell is escaped, not a new column", () => {
    const md = "| Formula | Note |\n| --- | --- |\n| a \\| b | ok |";
    expect(roundTrip(md)).toBe(md);
  });

  it("a backslash right before a pipe in a cell can't swallow the escape", () => {
    // The exporter escapes the text's backslash before the cell escapes the
    // pipe, so `a\|b` goes out as `a\\\|b`: GFM and the importer both read it
    // as one backslash and one pipe in the same cell.
    const md = "| Formula | Note |\n| --- | --- |\n| a\\\\\\|b | ok |";
    expect(roundTrip(md)).toBe(md);
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
    expect(JSON.stringify(editor.getEditorState().toJSON())).toContain('"text":"a\\\\|b"');
  });

  it("a line break inside a cell is `<br>`; a literal backslash-n stays text", () => {
    const md = "| Path | Note |\n| --- | --- |\n| C:\\new | line one<br>line two |";
    // The exporter escapes the backslash (`C:\\new`); after that the bytes hold.
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
    expect(once).toContain("line one<br>line two");
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString(once, NOTES_TRANSFORMERS), { discrete: true });
    const json = JSON.stringify(editor.getEditorState().toJSON());
    expect(json).toContain('"text":"C:\\\\new"');
    expect(json).toContain('"type":"linebreak"');
  });

  it("typing a pipe line does NOT become a table (import only)", () => {
    const editor = makeEditor();
    let handled: boolean | void = true;
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode("|x| "));
        $getRoot().append(p);
        handled = TABLE_TRANSFORMER.replace(p, [], ["|x| "], false);
      },
      { discrete: true },
    );
    expect(handled).toBe(false);
    editor.read(() => expect($getRoot().getFirstChild()?.getType()).toBe("paragraph"));
  });

  it("body_text is the plain projection: no markers, chips and page rows read as labels", () => {
    const { text } = deriveNoteBody(docFrom(FIDELITY_MD));
    expect(text.split("\n")[0]).toBe("Plan");
    expect(text).toContain("Talked to Jane Doe today.");
    expect(text).toContain("Kickoff notes");
    expect(text).not.toContain("**");
    expect(text).not.toContain("moduo://");
  });

  it("an empty doc derives empty bodies", () => {
    const doc = new Y.Doc();
    doc.get(NOTES_DOC_ROOT, Y.XmlElement);
    expect(deriveNoteBody(doc)).toEqual({ text: "", md: "" });
  });

  it("task-line ids are read off the doc (the trash flow's detach list)", () => {
    expect(extractTaskLineIds(docFrom(FIDELITY_MD))).toEqual(["task-123"]);
  });

  it("the old doc-text walker is gone", () => {
    expect(existsSync(resolve(__dirname, "../sync/doc-text.ts"))).toBe(false);
  });
});

describe("copy guard: a few words inside one block stay plain (NR-3)", () => {
  function partial(md: string, word: string): boolean {
    const editor = makeEditor();
    editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
    let result = false;
    editor.update(
      () => {
        const node = $getRoot()
          .getAllTextNodes()
          .find((t) => t.getTextContent().includes(word))!;
        const at = node.getTextContent().indexOf(word);
        const sel = $createRangeSelection();
        sel.anchor.set(node.getKey(), at, "text");
        sel.focus.set(node.getKey(), at + word.length, "text");
        result = $isPartialWithinOneBlock(sel);
      },
      { discrete: true },
    );
    return result;
  }

  it("a word in a heading, a checklist item or a table cell falls through", () => {
    expect(partial("## Q3 planning notes", "planning")).toBe(true);
    expect(partial("- [ ] buy milk today", "milk")).toBe(true);
    expect(partial("| a | b |\n| --- | --- |\n| xy | z |", "xy")).toBe(true);
  });

  it("a whole block is not partial (it copies as markdown)", () => {
    expect(partial("## planning", "planning")).toBe(false);
  });
});

describe("HR transformer (DF-13 — live typing path for MarkdownShortcutPlugin)", () => {
  it("import path: `---` round-trips as a divider", () => {
    expect(roundTrip("Intro\n\n---\n\nOutro")).toBe("Intro\n\n---\n\nOutro");
  });

  it("typing at the END of the doc keeps a caret paragraph after the divider", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createTextNode("---"));
        root.append(p);
        const match = /^(?:---|\*\*\*|___)\s?$/.exec("---")!;
        HR_TRANSFORMER.replace(p, [], match, false);
      },
      { discrete: true },
    );
    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children.map((c) => c.getType())).toEqual(["horizontalrule", "paragraph"]);
    });
  });

  it("typing MID-doc replaces the line and leaves the rest untouched", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p1 = $createParagraphNode();
        p1.append($createTextNode("---"));
        const p2 = $createParagraphNode();
        p2.append($createTextNode("after"));
        root.append(p1, p2);
        const match = /^(?:---|\*\*\*|___)\s?$/.exec("---")!;
        HR_TRANSFORMER.replace(p1, [], match, false);
      },
      { discrete: true },
    );
    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children.map((c) => c.getType())).toEqual(["horizontalrule", "paragraph"]);
      expect(children[1]!.getTextContent()).toBe("after");
    });
  });

  it("typing preserves inline content that followed `---` on the same line", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p1 = $createParagraphNode();
        p1.append($createTextNode("--- "));
        const p2 = $createParagraphNode();
        p2.append($createTextNode("after"));
        root.append(p1, p2);
        const match = /^(?:---|\*\*\*|___)\s?$/.exec("--- ")!;
        // The shortcut plugin hands `replace` the remainder inline nodes.
        HR_TRANSFORMER.replace(p1, [$createTextNode("kept text")], match, false);
      },
      { discrete: true },
    );
    editor.read(() => {
      const children = $getRoot().getChildren();
      expect(children.map((c) => c.getType())).toEqual([
        "horizontalrule",
        "paragraph",
        "paragraph",
      ]);
      expect(children[1]!.getTextContent()).toBe("kept text");
      expect(children[2]!.getTextContent()).toBe("after");
    });
  });
});
