/**
 * AC11 — markdown round-trip: md → blocks → md is stable for headings, lists,
 * checkboxes, chips and page-rows; unknown syntax degrades to text, never
 * throws. Runs in a headless Lexical editor (no DOM render — decorators are
 * never mounted).
 */

import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { createHeadlessEditor } from "@lexical/headless";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { describe, expect, it } from "@rstest/core";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { EntityRefNode } from "../../spine/editor/entity-ref-node";
import {
  blocksToMarkdown,
  HR_TRANSFORMER,
  looksLikeMarkdown,
  type MdJsonNode,
  NOTES_TRANSFORMERS,
} from "./markdown";
import { EmbedNode } from "./nodes/EmbedNode";
import { PageRowNode } from "./nodes/page-row-node";
import { TaskLineNode } from "./nodes/task-line-node";

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
      TaskLineNode,
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

  it("emits task lines with the stable-id comment (pending mints stay humble checkboxes)", () => {
    const blocks: MdJsonNode[] = [
      {
        type: "task-line",
        taskId: "task-1",
        done: true,
        children: [{ type: "text", text: "Ship it" }],
      },
      {
        type: "task-line",
        taskId: null, // mid-mint — no id to carry yet
        done: false,
        children: [{ type: "text", text: "Still minting" }],
      },
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      ["- [x] Ship it <!-- moduo:task:task-1 -->", "", "- [ ] Still minting"].join("\n"),
    );
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
