/**
 * AC11 — markdown round-trip: md → blocks → md is stable for headings, lists,
 * checkboxes, chips and page-rows; unknown syntax degrades to text, never
 * throws. Runs in a headless Lexical editor (no DOM render — decorators are
 * never mounted).
 */

import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "@lexical/headless";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { $getRoot } from "lexical";
import { EntityRefNode } from "../../spine/editor/entity-ref-node";
import { EmbedNode } from "./nodes/EmbedNode";
import { PageRowNode } from "./nodes/page-row-node";
import {
  blocksToMarkdown,
  looksLikeMarkdown,
  NOTES_TRANSFORMERS,
  type MdJsonNode,
} from "./markdown";

function makeEditor() {
  return createHeadlessEditor({
    namespace: "md-test",
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      AutoLinkNode,
      HorizontalRuleNode,
      TableNode,
      TableCellNode,
      TableRowNode,
      EntityRefNode,
      EmbedNode,
      PageRowNode,
    ],
    onError: (e: Error) => {
      throw e;
    },
  });
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
    editor.update(
      () => $convertFromMarkdownString("- [x] done\n- [ ] open", NOTES_TRANSFORMERS),
      { discrete: true },
    );
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

describe("blocksToMarkdown (the selection copy walker)", () => {
  it("emits blocks, inline formats, chips and checkboxes", () => {
    const blocks: MdJsonNode[] = [
      { type: "heading", tag: "h2", children: [{ type: "text", text: "Notes" }] },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Ping " },
          { type: "entity-ref", label: "Jane", entityType: "contact", entityId: "c1" },
          { type: "text", text: " re ", format: 0 },
          { type: "text", text: "pricing", format: 1 },
        ],
      },
      {
        type: "list",
        listType: "check",
        children: [
          { type: "listitem", checked: true, children: [{ type: "text", text: "sent" }] },
          { type: "listitem", checked: false, children: [{ type: "text", text: "follow up" }] },
        ],
      },
      { type: "page-row", label: "Child page", noteId: "n2" },
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      [
        "## Notes",
        "",
        "Ping [Jane](moduo://contact/c1) re **pricing**",
        "",
        "- [x] sent",
        "- [ ] follow up",
        "",
        "[Child page](moduo://note/n2)",
      ].join("\n"),
    );
  });
});
