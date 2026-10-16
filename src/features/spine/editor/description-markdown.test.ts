// A task's description in the editor (dogfood call #15, MOD-98 / MOD-120):
// Markdown round-trips through the description editor's transformers,
// references and date chips included; and a description the old editor saved
// as HTML (built here by that editor's own nodes and exporter) reads into the
// same structure. Headless: the schema files, no React.

import { createHeadlessEditor } from "@lexical/headless";
import { $generateHtmlFromNodes } from "@lexical/html";
import { $isLinkNode } from "@lexical/link";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isQuoteNode } from "@lexical/rich-text";
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
import {
  $exportDescription,
  $importDescription,
  $isRawTextNode,
  DESCRIPTION_MARKDOWN_NODES,
} from "./description-markdown";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./entity-ref-schema";

const TASK = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";

/** The description editor's nodes (format "markdown"). */
function markdownEditor() {
  return createHeadlessEditor({
    nodes: DESCRIPTION_MARKDOWN_NODES,
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

  it("a paragraph whose words start like a list, quote or checkbox stays a paragraph", () => {
    const starts = [
      "- first item",
      "+ plus",
      "* star",
      "1. numbered",
      "> said",
      "[ ] box",
      "[x] done",
    ];
    for (const words of starts) {
      const editor = markdownEditor();
      editor.update(
        () => {
          $getRoot().clear();
          // Two lines in one paragraph: the second starts like a block too.
          $getRoot().append(
            $createParagraphNode().append(
              $createTextNode(words),
              $createLineBreakNode(),
              $createTextNode(words),
            ),
          );
        },
        { discrete: true },
      );
      const saved = save(editor);
      expect(saved).toContain("\\");
      const reloaded = load(saved);
      const shape = reloaded.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .map((b) => [b.getType(), b.getTextContent()]),
      );
      expect(shape).toEqual([["paragraph", `${words}\n${words}`]]);
      expect(save(reloaded)).toBe(saved);
    }
    // Real lists and quotes still save as themselves.
    expect(save(load("- one\n- two\n\n1. first\n\n> said"))).toBe(
      "- one\n- two\n\n1. first\n\n> said",
    );
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

/** Load, change one word elsewhere (a real edit), save. */
function editAndSave(markdown: string): string {
  const editor = load(markdown);
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode("Edited.")));
    },
    { discrete: true },
  );
  return save(editor);
}

describe("code keeps its content as written (call #15's review)", () => {
  const PYTHON_CODE = [
    "def f(*args, **kwargs):",
    '    """__name__ and *stars*"""',
    "",
    "    return __name__ + `x` + a_b * 2",
  ].join("\n");
  const SQL_CODE = [
    "SELECT user_id, file_name FROM t WHERE a ~~ '%_x%' AND b = '\\';",
    "-- * not a list",
  ].join("\n");

  for (const [name, lang, code] of [
    ["Python", "python", PYTHON_CODE],
    ["SQL", "sql", SQL_CODE],
  ] as const) {
    it(`a ${name} fence round-trips verbatim, also after an edit elsewhere`, () => {
      const md = `Before:\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\nAfter.`;
      expect(save(load(md))).toBe(md);
      expect(editAndSave(md)).toBe(`${md}\n\nEdited.`);
      const editor = load(md);
      const inside = editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .find((b) => b.getType() === "code")
          ?.getTextContent(),
      );
      expect(inside).toBe(code);
    });
  }

  it("inline code keeps its content raw", () => {
    const md = "Use `__name__` and `a\\*b` and `` `tick` ``.";
    const editor = load(md);
    expect(save(editor)).toBe(md);
    const codes = editor.getEditorState().read(() =>
      $getRoot()
        .getAllTextNodes()
        .filter((n) => n.hasFormat("code"))
        .map((n) => n.getTextContent()),
    );
    expect(codes).toEqual(["__name__", "a\\*b", "`tick`"]);
  });
});

describe("words are escaped only where Markdown would read them (call #15's review)", () => {
  it("stores identifiers, lone stars and paths as written, and reads them back the same", () => {
    const words = "file_name and user_id, 5 * 3, a ~ b, C:\\Users\\me, one ` tick";
    const editor = markdownEditor();
    editor.update(
      () => {
        $getRoot().clear();
        $getRoot().append($createParagraphNode().append($createTextNode(words)));
      },
      { discrete: true },
    );
    const saved = save(editor);
    expect(saved).toBe(words);
    expect(
      load(saved)
        .getEditorState()
        .read(() => $getRoot().getTextContent()),
    ).toBe(words);
  });

  it("still escapes what would become formatting", () => {
    const words = "a*b* _x_ ~~gone~~ `code` two ``ticks`` \\* end_";
    const editor = markdownEditor();
    editor.update(
      () => {
        $getRoot().clear();
        $getRoot().append($createParagraphNode().append($createTextNode(words)));
      },
      { discrete: true },
    );
    const saved = save(editor);
    const reread = load(saved);
    expect(reread.getEditorState().read(() => $getRoot().getTextContent())).toBe(words);
    expect(
      all(reread)
        .filter($isTextNode)
        .every((n) => reread.getEditorState().read(() => n.getFormat() === 0)),
    ).toBe(true);
    expect(save(reread)).toBe(saved);
  });
});

describe("words never save as a reference", () => {
  const refs = (editor: ReturnType<typeof markdownEditor>) =>
    editor.getEditorState().read(() => all(editor).filter($isReferenceNode).length);
  const moduoLinks = (editor: ReturnType<typeof markdownEditor>) =>
    editor
      .getEditorState()
      .read(() => all(editor).filter((n) => $isLinkNode(n) && /moduo:/i.test(n.getURL())).length);

  it("words shaped like a reference save with their ( spelled out, read back as the same words", () => {
    const words = `see [x](moduo://task/${TASK}) here`;
    for (const format of [0, 1]) {
      const editor = markdownEditor();
      editor.update(
        () => {
          $getRoot().clear();
          $getRoot().append(
            $createParagraphNode().append($createTextNode(words).setFormat(format)),
          );
        },
        { discrete: true },
      );
      const saved = save(editor);
      expect(saved).toContain(`[x]&#40;moduo://task/${TASK})`);
      const reread = load(saved);
      expect(reread.getEditorState().read(() => $getRoot().getTextContent())).toBe(words);
      expect(refs(reread)).toBe(0);
      expect(save(reread)).toBe(saved);
    }
  });

  it("stored words that read back as a reference's shape stay words, however often they're saved", () => {
    for (const stored of [
      `[x]&#40;moduo://task/${TASK})`,
      `[x]\\(moduo://task/${TASK})`,
      `**[x]&#40;moduo://task/${TASK})**`,
      `[[a]&#40;moduo://task/${TASK})](https://example.com)`,
    ]) {
      let value = stored;
      for (let round = 0; round < 3; round++) {
        const editor = load(value);
        expect(refs(editor), `${stored} (round ${round})`).toBe(0);
        expect(moduoLinks(editor), `${stored} (round ${round})`).toBe(0);
        value = save(editor);
      }
    }
  });
});

describe("text read raw saves back exactly (call #15's review)", () => {
  it("a costly line saves the same twice, escapes and all", () => {
    const line = `${"user_id a*b \\_ \\\\ `tick` [x] ".repeat(200)}end`;
    expect(line.length).toBeGreaterThan(5_000);
    const md = `**Bold** before.\n\n${line}\n\nAfter *it*.`;
    const once = save(load(md));
    expect(once).toBe(md);
    expect(save(load(once))).toBe(once);
    const raw = all(load(md)).filter($isRawTextNode);
    expect(raw).toHaveLength(1);
  });

  it("everything past the total saves the same twice", () => {
    const md = Array.from({ length: 6_000 }, (_, i) => `line_${i} a\\*b \\_x\\_`).join("\n\n");
    const once = save(load(md));
    expect(once).toBe(md);
    expect(save(load(once))).toBe(once);
  });
});

describe("a long description is cut only between blocks (call #15's review)", () => {
  it("a paragraph or quote of more than 100 lines comes back whole, with no blank line inside", () => {
    const paragraph = Array.from({ length: 150 }, (_, i) => `Line ${i} of the paragraph.`).join(
      "\n",
    );
    const quote = Array.from({ length: 120 }, (_, i) => `> Quoted ${i}.`).join("\n");
    const md = `${paragraph}\n\n${quote}\n\nThe end.`;
    const once = save(load(md));
    expect(once).toBe(md);
    expect(save(load(once))).toBe(once);
  });

  it("a big list and a fence with blank lines inside stay Markdown", () => {
    const list = Array.from({ length: 300 }, (_, i) => `- item ${i}`).join("\n");
    const fence = `\`\`\`\n${Array.from({ length: 120 }, (_, i) => (i % 10 === 0 ? "" : `code ${i}`)).join("\n")}\n\`\`\``;
    const md = `${list}\n\n${fence}\n\nDone.`;
    const editor = load(md);
    const types = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((b) => b.getType()),
    );
    expect(types).toEqual(["list", "code", "paragraph"]);
    expect(save(editor)).toBe(md);
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
    // Dense emphasis: thousands of formatted runs, slow to read and slower to save.
    ["a short line of *a", "*a".repeat(2_500)],
    ["list items of *a", Array.from({ length: 20 }, () => `- ${"*a".repeat(2_400)}`).join("\n")],
    [
      "a long list of emphasis",
      Array.from({ length: 2_000 }, () => "- *a*b* ~~c~~ _d_").join("\n"),
    ],
    ["a list item with thousands of lines", `- a\n${"  more [x](\n".repeat(2_000)}`],
    [
      "a big list of links",
      Array.from({ length: 1_200 }, () => `- ${"[x](".repeat(75)}`).join("\n"),
    ],
    [
      "blocks just under each cap",
      Array.from({ length: 300 }, () => "`a ".repeat(149)).join("\n\n"),
    ],
    ["a quote of thousands of lines", "> [x](\n".repeat(3_000)],
    ["a fence of 100 KB", `\`\`\`\n${"[x]( `a ".repeat(12_000)}\n\`\`\``],
    // Every delimiter the transformers react to, in long runs and spread over
    // many blocks just under the per-line cap (the parser-differential review).
    ["runs of *a", Array.from({ length: 40 }, () => "*a".repeat(2_400)).join("\n\n")],
    ["runs of _a", Array.from({ length: 40 }, () => "_a ".repeat(1_600)).join("\n\n")],
    ["runs of ~~a", Array.from({ length: 40 }, () => "~~a".repeat(1_600)).join("\n\n")],
    [
      "nested links",
      Array.from({ length: 40 }, () => `${"[".repeat(299)}a${"](b)".repeat(299)}`).join("\n\n"),
    ],
    ["runs of [a](", Array.from({ length: 40 }, () => "[a](".repeat(1_200)).join("\n\n")],
    ["runs of ](", Array.from({ length: 40 }, () => "](".repeat(2_400)).join("\n\n")],
    ["escapes", Array.from({ length: 40 }, () => "\\*\\_".repeat(1_200)).join("\n\n")],
    ["blocks of 299 *a", Array.from({ length: 60 }, () => "*a".repeat(149)).join("\n\n")],
    ["blocks of 299 ~~", Array.from({ length: 60 }, () => "~~a".repeat(100)).join("\n\n")],
    ["blocks of 299 _a_", Array.from({ length: 60 }, () => " _a_".repeat(149)).join("\n\n")],
  ] as const) {
    it(`reads and saves ${name} quickly`, () => {
      let editor = markdownEditor();
      expect(
        timed(() => {
          editor = load(md);
        }),
      ).toBeLessThan(1500);
      expect(timed(() => save(editor))).toBeLessThan(1500);
    });
  }

  it("the guard counts every delimiter the transformers react to", () => {
    for (const unit of ["*a ", " _a ", "~a ", "[a ", "]a ", "(a ", ")a ", "!a ", "`a ", "\\a "]) {
      const line = unit.repeat(301).trim();
      const editor = load(`Fine **words**.\n\n${line}`);
      // The dense line reads raw (saved back exactly); the words before stay Markdown.
      expect(all(editor).filter($isRawTextNode)).toHaveLength(1);
      expect(save(editor)).toBe(`Fine **words**.\n\n${line}`);
    }
    // Identifiers cost nothing: inside a word `_` can't start emphasis.
    const identifiers = Array.from({ length: 300 }, (_, i) => `file_name_${i}`).join(" ");
    expect(all(load(identifiers)).filter($isRawTextNode)).toHaveLength(0);
  });

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
      "constructor",
    ]) {
      expect(referenceWord(type)).toBe(referenceNoun(referenceKind(type)));
    }
  });
});
