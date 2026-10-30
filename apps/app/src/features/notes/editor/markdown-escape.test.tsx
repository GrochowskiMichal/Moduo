/**
 * Stored markdown (`body_md`: MCP reads, the published page, `.md` export)
 * escapes only what would change meaning. Text written into a note must read
 * back as the same text through both readers of `body_md`: Lexical's importer
 * (agent edits, repair) and react-markdown + GFM (the published page).
 */

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from "@lexical/markdown";
import { $createHeadingNode } from "@lexical/rich-text";
import { $createTableCellNode, $createTableNode, $createTableRowNode } from "@lexical/table";
import { describe, expect, it } from "@rstest/core";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type TextFormatType,
} from "lexical";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { $noteMarkdown, createNotesHeadlessEditor } from "./doc-markdown";
import { NOTES_TRANSFORMERS } from "./markdown";
import { STORED_TEXT_EXPORT } from "./markdown-escape";

/** A run of text with its format; "\n" is a line break. */
type Segment = [text: string, format?: TextFormatType];

/** `body_md` of a note holding one paragraph made of `segments` (or its
 * markdown through other `transformers`). */
function storedSegments(segments: Segment[], transformers?: Transformer[]): string {
  const { editor } = createNotesHeadlessEditor("stored-md");
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      for (const [text, format] of segments) {
        text.split("\n").forEach((line, i) => {
          if (i > 0) paragraph.append($createLineBreakNode());
          if (line === "") return;
          const node = $createTextNode(line);
          if (format) node.toggleFormat(format);
          paragraph.append(node);
        });
      }
      $getRoot().append(paragraph);
    },
    { discrete: true },
  );
  return editor
    .getEditorState()
    .read(() => (transformers ? $convertToMarkdownString(transformers) : $noteMarkdown()));
}

/** `body_md` of a note holding `text` as one plain paragraph (lines are
 * line breaks, as a paste makes them). */
const storedMarkdown = (text: string) => storedSegments([[text]]);

const FORMAT_BIT: Partial<Record<TextFormatType, string>> = {
  bold: "1",
  italic: "2",
  strikethrough: "4",
  code: "g",
  highlight: "h",
};
const PAGE_TAG: Partial<Record<TextFormatType, string>> = {
  bold: "s",
  italic: "e",
  strikethrough: "d",
  code: "c",
};

/** One character per character of `segments`: its format's code in `codes`. */
const formatsOf = (segments: Segment[], codes: Partial<Record<TextFormatType, string>>) =>
  segments.map(([t, f]) => (f ? codes[f]! : "0").repeat(t.length)).join("");

/** Each character's format as Lexical's importer reads `md` back. */
function lexicalFormats(md: string): string {
  const { editor } = createNotesHeadlessEditor("stored-md-formats");
  editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
  const code = (format: number) =>
    format === 0 ? "0" : format === 16 ? "g" : format === 128 ? "h" : `${format}`;
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .flatMap((b) => ($isElementNode(b) ? b.getAllTextNodes() : []))
      .map((n) => code(n.getFormat()).repeat(n.getTextContentSize()))
      .join(""),
  );
}

/** The page's text, and each character's formatting there: s(trong),
 * e(m), d(el), c(ode), or 0. */
function pageFormats(md: string): { text: string; formats: string } {
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>,
  );
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let text = "";
  let formats = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const tags = new Set<string>();
    for (let el = node.parentElement; el && el !== body; el = el.parentElement)
      tags.add(el.tagName);
    const tag = ["STRONG", "EM", "DEL", "CODE"].find((t) => tags.has(t));
    const value = node.textContent ?? "";
    text += value;
    formats += (tag ? tag[0]!.toLowerCase() : "0").repeat(value.length);
  }
  return { text, formats };
}

/** What Lexical's importer makes of `md`: the text, and whether every run
 * stayed plain (one paragraph, no formats). */
function lexicalRead(md: string): { text: string; plain: boolean } {
  const { editor } = createNotesHeadlessEditor("stored-md-read");
  editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
  return editor.getEditorState().read(() => {
    const blocks = $getRoot().getChildren();
    const leaves = blocks.flatMap((b) => ($isElementNode(b) ? b.getAllTextNodes() : []));
    const plain =
      blocks.length === 1 &&
      blocks[0]!.getType() === "paragraph" &&
      leaves.every((n) => n.getFormat() === 0 && n.getType() === "text");
    return { text: $getRoot().getTextContent(), plain };
  });
}

/** What the published page shows for `md`: its text, and whether that is one
 * plain paragraph (no emphasis, code, heading, list, quote, link…). */
function pageRead(md: string): { text: string; plain: boolean } {
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>,
  );
  const host = new DOMParser().parseFromString(html, "text/html").body;
  const plain =
    host.children.length === 1 &&
    host.firstElementChild!.tagName === "P" &&
    host.firstElementChild!.querySelector("*:not(a)") === null;
  return { text: host.textContent ?? "", plain };
}

function expectLiteral(text: string) {
  const md = storedMarkdown(text);
  expect({ md, ...lexicalRead(md) }).toEqual({ md, text, plain: true });
  expect({ md, ...pageRead(md) }).toEqual({ md, text, plain: true });
}

describe("stored markdown: no escapes where nothing would be read as syntax", () => {
  it.each([
    ["a Supabase-style id", "sbp_fc7797a1b2c3"],
    ["a Stripe-style id", "sk_live_51H_abcDEF"],
    ["env lines", "SUPABASE_URL=https://abc.supabase.co\nSERVICE_KEY=sb_secret_x_y"],
    ["base64 padding", "key1==\nkey2=="],
    ["a cookie name", "__Secure-next-auth.session-token"],
    ["a private name", "_private_var here"],
    ["an email", "first_last@example.com"],
    ["a Windows path", "C:\\Users\\mike\\file_name.txt"],
    ["a home path", "~/code/moduo and ~/notes"],
    ["a spaced star", "a * b"],
    ["one backtick", "pa`ss"],
  ])("%s", (_name, text) => {
    expect(storedMarkdown(text)).toBe(text);
    expectLiteral(text);
  });
});

describe("stored markdown: escapes where they change meaning", () => {
  it.each([
    ["stars that pair", "2*3*4", "2\\*3\\*4"],
    ["text that looks like emphasis", "*not italic* and **literal**", null],
    ["underscores at word edges", "_a_ b", "\\_a\\_ b"],
    ["tildes that pair", "~a~ and ~~b~~", null],
    ["highlight-shaped", "x==y==z", null],
    ["two backtick runs", "a`b`c", "a\\`b\\`c"],
    ["a backslash before punctuation", "\\_ and \\*", null],
    ["an entity", "&amp; &#32; &#x41;", "&#38;amp; &#38;#32; &#38;#x41;"],
    [
      "a heading line",
      "# Supabase\nSUPABASE_URL=https://a.co",
      "\\# Supabase\nSUPABASE_URL=https://a.co",
    ],
    ["a quote line", "> not a quote", "\\> not a quote"],
    ["bullet lines", "- a\n+ b\n* c", null],
    ["ordered lines", "1. a\n2) b", "1\\. a\n2\\) b"],
    ["a fence", "```js", null],
    ["a divider", "---", "\\---"],
    ["a setext underline", "Title\n===", "Title\n\\=\\=\\="],
    ["a table row", "| a | b |", "\\| a | b |"],
    ["a checkbox", "[x] done", "\\[x] done"],
  ])("%s", (_name, text, md) => {
    if (md !== null) expect(storedMarkdown(text)).toBe(md);
    expectLiteral(text);
  });

  it("a backslash ending a line before a break: escaped, but only the page keeps it", () => {
    const md = storedMarkdown("docker run \\\n  image");
    expect(md).toBe("docker run \\\\\n  image");
    expect(pageRead(md).text).toBe("docker run \\\nimage");
    // Lexical's importer tests a line for a hard-break backslash after it has
    // unescaped it, so this one reads as a break whatever the escaping. When
    // this fails, Lexical fixed it: let the fuzz below end lines with `\`.
    expect(lexicalRead(md).text).toBe("docker run \n  image");
  });

  it.each([
    ["an emoji between stars", "a*🔥 b*"],
    ["an emoji after a star", "great*👍 and fine*"],
    ["an emoji between tildes", "x~🎉 y~"],
    ["a star beside an underscore", "a*_b c*"],
    ["a link", "see [docs](https://a.co) now"],
    ["an image", "![x](y)"],
    ["a reference definition", "[1]: https://a.co"],
    ["a table delimiter row", "a | b\n|-|-"],
    ["a symbol beside stars", "→*a*→"],
  ])("%s stays literal", (_name, text) => {
    expectLiteral(text);
  });

  it("a delimiter touching a format marker of its own character stays apart from it", () => {
    for (const segments of [
      [["2*"], ["3", "italic"]],
      [["a~"], ["b", "strikethrough"]],
      [["x="], ["y", "highlight"]],
      [["b", "bold"], ["*c"]],
    ] as Segment[][]) {
      const md = storedSegments(segments);
      expect({ md, formats: lexicalFormats(md) }).toEqual({
        md,
        formats: formatsOf(segments, FORMAT_BIT),
      });
      if (segments.some(([, f]) => f === "highlight")) continue; // GFM has no highlight
      expect({ md, ...pageFormats(md) }).toEqual({
        md,
        text: segments.map(([t]) => t).join(""),
        formats: formatsOf(segments, PAGE_TAG),
      });
    }
  });

  it("a table cell's paragraphs pair as one block", () => {
    const { editor } = createNotesHeadlessEditor("stored-md-table");
    editor.update(
      () => {
        const header = $createTableCellNode().append(
          $createParagraphNode().append($createTextNode("h")),
        );
        const cell = $createTableCellNode().append(
          $createParagraphNode().append($createTextNode("*a")),
          $createParagraphNode().append($createTextNode("b*")),
        );
        $getRoot().append(
          $createTableNode().append(
            $createTableRowNode().append(header),
            $createTableRowNode().append(cell),
          ),
        );
      },
      { discrete: true },
    );
    expect(editor.getEditorState().read($noteMarkdown)).toContain("\\*a<br>b\\*");
  });

  it("a heading of only a hash keeps it", () => {
    const { editor } = createNotesHeadlessEditor("stored-md-hash");
    editor.update(() => $getRoot().append($createHeadingNode("h2").append($createTextNode("#"))), {
      discrete: true,
    });
    expect(pageFormats(editor.getEditorState().read($noteMarkdown)).text).toBe("#");
  });

  it("a PEM block keeps its dashes bare", () => {
    const pem = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq+hkiG9w0B\n-----END PUBLIC KEY-----";
    expect(storedMarkdown(pem)).toBe(pem);
    expectLiteral(pem);
  });

  it("a heading's trailing hashes survive", () => {
    const { editor } = createNotesHeadlessEditor("stored-md-heading");
    editor.update(() => $convertFromMarkdownString("## C# and F \\#", NOTES_TRANSFORMERS), {
      discrete: true,
    });
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("C# and F #");
    expect(editor.getEditorState().read($noteMarkdown)).toBe("## C# and F \\#");
  });

  it("formatted runs keep their markers, with literal text inside", () => {
    const { editor } = createNotesHeadlessEditor("stored-md-format");
    editor.update(
      () =>
        $convertFromMarkdownString(
          "## Keys\n\n- **sk_live_x** for prod\n- `npm_token` in CI",
          NOTES_TRANSFORMERS,
        ),
      { discrete: true },
    );
    expect(editor.getEditorState().read($noteMarkdown)).toBe(
      "## Keys\n\n- **sk_live_x** for prod\n- `npm_token` in CI",
    );
  });
});

/** Seeded, so a failure reproduces. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("stored markdown: any plain text reads back as itself", () => {
  // Characters markdown gives meaning to, plus words and punctuation around
  // them. Lines are trimmed (both readers trim paragraph lines) and never
  // empty (a blank line ends the paragraph); no URLs (GFM links them); a line
  // before another never ends in `\` (Lexical's hard break, tested above).
  const pieces = [
    "a",
    "b",
    "x1",
    "_",
    "__",
    "*",
    "**",
    "~",
    "~~",
    "==",
    "=",
    "`",
    "``",
    "\\",
    "#",
    "##",
    ">",
    "-",
    "+",
    "1.",
    "2)",
    "|",
    "[",
    "]",
    "[x]",
    "(",
    ")",
    "!",
    "&",
    "&amp;",
    "&#32;",
    ";",
    ".",
    ",",
    ":",
    "/",
    "'",
    '"',
    "<",
    "é",
    "ż",
    "😀",
    "🔥",
    "→",
    "---",
    "===",
    " ",
    " ",
    " ",
  ];
  const next = random(20261030);
  const pick = () => pieces[Math.floor(next() * pieces.length)]!;
  const cases = Array.from({ length: 400 }, () =>
    Array.from({ length: 1 + Math.floor(next() * 3) }, () => {
      const line = Array.from({ length: 1 + Math.floor(next() * 8) }, pick)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      return line === "" || line.endsWith("\\") ? `${line}a` : line;
    }).join("\n"),
  );

  it("through Lexical's importer and the published page", () => {
    const failures = cases.filter((text) => {
      const md = storedMarkdown(text);
      const lexical = lexicalRead(md);
      const page = pageRead(md);
      return !(lexical.plain && lexical.text === text && page.plain && page.text === text);
    });
    expect(failures).toEqual([]);
  });

  // Lexical's own exporter puts a run's markers right against its text, so a
  // formatted run that starts or ends in punctuation (`*:*1`) can fail to
  // read back whatever the escaping. Beside formatted runs the bar is
  // therefore Lexical's escape-everything export: wherever it reads back,
  // this one must too.
  it("beside formatted runs, through both readers, wherever escaping everything does", () => {
    const escapeAll = NOTES_TRANSFORMERS.filter((t) => t !== STORED_TEXT_EXPORT);
    const formats = [undefined, undefined, undefined, "bold", "italic", "strikethrough", "code"];
    const segmentCases = Array.from({ length: 400 }, () =>
      Array.from({ length: 1 + Math.floor(next() * 4) }, (): Segment => {
        const text = Array.from({ length: 1 + Math.floor(next() * 4) }, pick)
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        const format = formats[Math.floor(next() * formats.length)] as TextFormatType | undefined;
        return [text === "" || text.endsWith("\\") ? `${text}a` : text, format];
      }),
    );
    const reads = (md: string, segments: Segment[]) => {
      const page = pageFormats(md);
      return {
        lexical: lexicalFormats(md) === formatsOf(segments, FORMAT_BIT),
        page:
          page.text === segments.map(([t]) => t).join("") &&
          page.formats === formatsOf(segments, PAGE_TAG),
      };
    };
    const failures = segmentCases.flatMap((segments) => {
      const md = storedSegments(segments);
      const now = reads(md, segments);
      const before = reads(storedSegments(segments, escapeAll), segments);
      const ok = (now.lexical || !before.lexical) && (now.page || !before.page);
      return ok ? [] : [{ segments, md }];
    });
    expect(failures).toEqual([]);
  });

  it("works per block, not per run: a 2,000-line paste exports in a fraction of the 6.5 s per-run work took", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `user_id=${i} *ok* req_id=abc_def`);
    const started = performance.now();
    storedMarkdown(lines.join("\n"));
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
