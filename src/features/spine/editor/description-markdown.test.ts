// A task's description in the editor (dogfood call #15, MOD-98 / MOD-120):
// Markdown round-trips through the description editor's transformers,
// references and date chips included; and a description the old editor saved
// as HTML (built here by that editor's own nodes and exporter) reads into the
// same structure. Headless: the schema files, no React.

import { createHeadlessEditor } from "@lexical/headless";
import { $generateHtmlFromNodes } from "@lexical/html";
import { $isLinkNode, LinkNode } from "@lexical/link";
import { $isListItemNode, $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { $isQuoteNode, QuoteNode } from "@lexical/rich-text";
import { describe, expect, it } from "@rstest/core";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isParagraphNode,
  $isTextNode,
  type LexicalNode,
} from "lexical";

import { referenceWord } from "../../../../supabase/functions/_shared/description-markdown";
import { $createDateNode, $isDateNode, DateNode } from "../references/date-node";
import { referenceKind, referenceNoun } from "../references/kinds";
import { $exportDescription, $importDescription } from "./description-markdown";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./entity-ref-schema";

const TASK = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";

/** The description editor's nodes (format "markdown"). */
function markdownEditor() {
  return createHeadlessEditor({
    nodes: [ReferenceNode, DateNode, ListNode, ListItemNode, QuoteNode, LinkNode],
    onError: (error) => {
      throw error;
    },
  });
}

function load(value: string) {
  const editor = markdownEditor();
  editor.update(() => $importDescription(value), { discrete: true });
  return editor;
}

function save(editor: ReturnType<typeof markdownEditor>): string {
  return editor.getEditorState().read(() => $exportDescription());
}

/** Every node under the root, depth first. */
function all(editor: ReturnType<typeof markdownEditor>): LexicalNode[] {
  return editor.getEditorState().read(() => {
    const out: LexicalNode[] = [];
    const walk = (node: LexicalNode) => {
      out.push(node);
      if ($isElementNode(node)) for (const child of node.getChildren()) walk(child);
    };
    for (const child of $getRoot().getChildren()) walk(child);
    return out;
  });
}

describe("a description's Markdown round-trips through the editor", () => {
  const MD = [
    "**Adding an issue**",
    "",
    `Put it in *Triage*, see [task](moduo://task/${TASK}) and [note](moduo://note/${NOTE} "card"), due [Oct 17](moduo://date/2026-10-17).`,
    "Line two of the same paragraph with `code` and ~~gone~~ and [docs](https://example.com).",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "- [ ] open",
    "- [x] done",
    "",
    "> quoted",
  ].join("\n");

  it("comes back as it went in", () => {
    const once = save(load(MD));
    expect(once).toBe(MD);
    expect(save(load(once))).toBe(once);
  });

  it("references are reference nodes with no title, dates are date chips", () => {
    const editor = load(MD);
    const nodes = all(editor);
    const refs = editor
      .getEditorState()
      .read(() =>
        nodes
          .filter($isReferenceNode)
          .map((n) => ({ ...n.exportJSON(), type: undefined, version: undefined })),
      );
    expect(refs).toEqual([
      expect.objectContaining({ entityType: "task", entityId: TASK, display: "chip", label: "" }),
      expect.objectContaining({ entityType: "note", entityId: NOTE, display: "card", label: "" }),
    ]);
    const days = editor
      .getEditorState()
      .read(() => nodes.filter($isDateNode).map((n) => n.getDay()));
    expect(days).toEqual(["2026-10-17"]);
    // No moduo:// address became a plain link; the real link did.
    const links = editor
      .getEditorState()
      .read(() => nodes.filter($isLinkNode).map((n) => n.getURL()));
    expect(links).toEqual(["https://example.com"]);
  });

  it("lists, checkboxes and quotes are their blocks, not literal markers", () => {
    const editor = load(MD);
    const nodes = all(editor);
    const shape = editor.getEditorState().read(() => ({
      lists: nodes.filter($isListNode).map((n) => n.getListType()),
      checked: nodes.filter($isListItemNode).map((n) => n.getChecked() ?? null),
      quotes: nodes.filter($isQuoteNode).length,
      text: $getRoot().getTextContent(),
    }));
    expect(shape.lists).toEqual(["bullet", "number", "check"]);
    expect(shape.checked).toEqual([null, null, null, null, false, true]);
    expect(shape.quotes).toBe(1);
    expect(shape.text).not.toContain("[x]");
    expect(shape.text).not.toContain("**");
  });

  it("a line break stays a line break, a blank line a new paragraph", () => {
    const editor = load("one\ntwo\n\nthree");
    const blocks = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((b) => ($isParagraphNode(b) ? b.getChildren().map((c) => c.getType()) : [])),
    );
    expect(blocks).toEqual([["text", "linebreak", "text"], ["text"]]);
    expect(save(editor)).toBe("one\ntwo\n\nthree");
  });

  it("an empty editor saves nothing, and words that read as HTML keep their < escaped", () => {
    expect(save(load(""))).toBe("");
    const editor = markdownEditor();
    editor.update(
      () => {
        $getRoot().clear();
        $getRoot().append($createParagraphNode().append($createTextNode("<span> wraps wrong")));
      },
      { discrete: true },
    );
    expect(save(editor)).toBe("\\<span> wraps wrong");
    expect(all(load(save(editor)))).toHaveLength(2);
    expect(save(load(save(editor)))).toBe("\\<span> wraps wrong");
  });
});

describe("an old HTML description reads into the editor as Markdown", () => {
  /** What the old description editor (format "html") stored. */
  function oldHtml(): string {
    const editor = createHeadlessEditor({
      nodes: [ReferenceNode, DateNode],
      theme: { paragraph: "mb-2 last:mb-0", text: { bold: "font-semibold", italic: "italic" } },
      onError: (error) => {
        throw error;
      },
    });
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const p = $createParagraphNode();
        p.append(
          $createTextNode("Q&A <draft> "),
          $createTextNode("bold").toggleFormat("bold"),
          $createTextNode(" "),
          $createTextNode("both").toggleFormat("bold").toggleFormat("italic"),
          $createLineBreakNode(),
          $createTextNode("See "),
          $createReferenceNode({ entityType: "task", entityId: TASK }),
          $createTextNode(" "),
          // An older chip with its title stored (before RF-1).
          $createReferenceNode({
            entityType: "note",
            entityId: NOTE,
            label: "Secret",
            display: "card",
          }),
          $createTextNode(" by "),
          $createDateNode("2026-10-17"),
        );
        const p2 = $createParagraphNode().append($createTextNode("Second"));
        root.append(p, $createParagraphNode(), p2);
      },
      { discrete: true },
    );
    return editor.getEditorState().read(() => $generateHtmlFromNodes(editor, null));
  }

  it("keeps the words, formats, references and dates, and drops a stored title", () => {
    const html = oldHtml();
    expect(html).toContain('<p class="mb-2 last:mb-0">');
    const editor = load(html);
    const markdown = save(editor);
    expect(markdown).toBe(
      `Q&A <draft> **bold** ***both***\nSee [task](moduo://task/${TASK}) [note](moduo://note/${NOTE} "card") by [Oct 17](moduo://date/2026-10-17)\n\nSecond`,
    );
    expect(markdown).not.toContain("Secret");
    const nodes = all(editor);
    const bold = editor.getEditorState().read(() =>
      nodes
        .filter($isTextNode)
        .filter((n) => n.hasFormat("bold"))
        .map((n) => n.getTextContent()),
    );
    expect(bold).toEqual(["bold", "both"]);
  });
});

describe("a crafted description can't freeze the editor", () => {
  const timed = (fn: () => unknown) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  for (const [name, md] of [
    ["a long line of code ticks", "`a ".repeat(25_000)],
    ["a long line of links that never close", "[x](".repeat(15_000)],
    ["a long line of [", "[".repeat(60_000)],
    ["many lines of links that never close", `${"[x](".repeat(600)}\n`.repeat(40)],
    ["many lines of code ticks", `${"`".repeat(4_900)}\n`.repeat(20)],
    ["a million short lines", "a\n".repeat(500_000)],
    ["2,500 short lines under the size limit", "a\n".repeat(2_500)],
    ["many lines past the total", `${"**bold** and `code`\n".repeat(20_000)}`],
  ] as const) {
    it(`imports ${name} quickly`, () => {
      expect(timed(() => load(md))).toBeLessThan(1500);
    });
  }

  it("a line past the limit comes in as plain text; the lines before it stay Markdown", () => {
    const long = "x".repeat(6_000);
    const editor = load(`**short** line\n\n${long}`);
    const nodes = all(editor);
    const bold = editor.getEditorState().read(() =>
      nodes
        .filter($isTextNode)
        .filter((n) => n.hasFormat("bold"))
        .map((n) => n.getTextContent()),
    );
    expect(bold).toEqual(["short"]);
    expect(save(editor)).toBe(`**short** line\n\n${long}`);
  });

  it("a long ordinary description, read in chunks, comes back as it went in", () => {
    const block = (i: number) =>
      `**Part ${i}** with a [link](https://example.com/${i}) and \`code\`.\nIts second line.\n\n- one\n- two\n\n- [ ] three\n- [x] four\n\n> quoted ${i}`;
    const md = Array.from({ length: 120 }, (_, i) => block(i)).join("\n\n");
    expect(md.length).toBeGreaterThan(10_000);
    expect(save(load(md))).toBe(md);
  });
});

describe("a reference's label", () => {
  it("is the app's word for its kind (the connector and the editor agree)", () => {
    for (const type of [
      "task",
      "email",
      "email_thread",
      "contact",
      "company",
      "note",
      "event",
      "project",
      "bucket",
      "tag",
      "mystery",
    ]) {
      expect(referenceWord(type)).toBe(referenceNoun(referenceKind(type)));
    }
  });
});
