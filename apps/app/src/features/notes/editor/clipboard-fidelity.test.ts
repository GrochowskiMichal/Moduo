/**
 * Clipboard fidelity: plain text pasted into a note copies back out as the
 * same text. A key, path or URL kept in a note for a moment must never come
 * back with `\_` in it, and pasted lines must not gain blank lines between
 * them. Runs in a headless editor with the live node set, through the same
 * decisions the clipboard plugin makes.
 */

import { $insertDataTransferForRichText } from "@lexical/clipboard";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { $createHeadingNode } from "@lexical/rich-text";
import { describe, expect, it } from "@rstest/core";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $selectAll,
  $setSelection,
  type LexicalEditor,
} from "lexical";

import { createNotesHeadlessEditor } from "./doc-markdown";
import { looksLikeMarkdown, NOTES_TRANSFORMERS } from "./markdown";
import {
  $copyPlainText,
  $insertPlainTextLines,
  keepListNumbers,
} from "./plugins/markdown-clipboard-plugin";

function paste(editor: LexicalEditor, text: string) {
  editor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("no selection");
      if (looksLikeMarkdown(text)) {
        $convertFromMarkdownString(keepListNumbers(text), NOTES_TRANSFORMERS);
        return;
      }
      if ($insertPlainTextLines(selection, text)) return;
      const data = {
        types: ["text/plain"],
        getData: (t: string) => (t === "text/plain" ? text : ""),
      };
      $insertDataTransferForRichText(data as unknown as DataTransfer, selection);
    },
    { discrete: true },
  );
}

/** What lands in the clipboard's text/plain: the plugin's text, or Lexical's
 * own plain text when the plugin steps aside. */
function copyAll(editor: LexicalEditor): string {
  let out = "";
  editor.update(
    () => {
      $selectAll();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("no selection");
      out = $copyPlainText(selection) ?? selection.getTextContent();
    },
    { discrete: true },
  );
  return out;
}

function pastedEditor(text: string): LexicalEditor {
  const { editor } = createNotesHeadlessEditor("clipboard-fidelity");
  editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), { discrete: true });
  paste(editor, text);
  return editor;
}

function pasteThenCopy(text: string): string {
  return copyAll(pastedEditor(text));
}

/** The top-level block types, in order. */
function blockTypes(editor: LexicalEditor): string[] {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((block) => block.getType()),
  );
}

describe("clipboard fidelity: pasted text copies back unchanged", () => {
  it.each([
    ["a Supabase-style id", "sbp_fc7797a1b2c3"],
    ["a Stripe-style id", "sk_live_51H_abcDEF"],
    ["a dotted base64url token", "head_er.pay_load.sig-nat_ure"],
    ["a cookie name", "__Secure-next-auth.session-token"],
    ["an env line", "SUPABASE_URL=https://abc.supabase.co"],
    ["a URL", "https://example.com/_next/static/a_b?x=1&y=_z#frag_1"],
    ["an email", "first_last@example.com"],
    ["a Windows path", "C:\\Users\\mike\\file_name.txt"],
    ["a home path", "~/code/moduo"],
    ["a glob", "**/*.ts"],
    ["stars and backticks", "2*3*4 and pa`ss"],
    ["text that looks like emphasis", "*not italic* and **literal**"],
    ["leading spaces", "  indented"],
  ])("%s", (_name, text) => {
    expect(pasteThenCopy(text)).toBe(text);
  });

  it("pasted lines keep single line breaks (no blank lines added)", () => {
    const pem = [
      "-----BEGIN PUBLIC KEY-----",
      "MIIBIjANBgkq+hkiG9w0B",
      "AQEFAAOCAQ8AMIIBCgKC",
      "-----END PUBLIC KEY-----",
    ].join("\n");
    expect(pasteThenCopy(pem)).toBe(pem);
    expect(pasteThenCopy("line1\nline2")).toBe("line1\nline2");
    expect(pasteThenCopy("a\r\nb")).toBe("a\nb");
  });

  it("blank lines stay blank lines, as empty paragraphs", () => {
    expect(pasteThenCopy("para one\n\npara two")).toBe("para one\n\npara two");
    expect(pasteThenCopy("a\n\n\nb")).toBe("a\n\n\nb");
    expect(pasteThenCopy("a\nb\n\nc\nd")).toBe("a\nb\n\nc\nd");
    expect(blockTypes(pastedEditor("a\n\nb"))).toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  it("an env file pastes as text, not as a heading", () => {
    const env = "# Supabase\nSUPABASE_URL=https://a.co\nexport SERVICE_KEY=sb_secret_x_y";
    expect(looksLikeMarkdown(env)).toBe(false);
    expect(pasteThenCopy(env)).toBe(env);
  });

  it.each([
    [
      "a shell script",
      "#!/usr/bin/env bash\n# deploy\nset -euo pipefail\nnpm run build -- --mode=prod",
    ],
    ["shell steps", "# install\nnpm i\n\n# build\nnpm run build"],
    ["YAML", "# Database\ndb:\n  host: localhost\n  port: 5432\n# Cache\n- redis"],
    ["Python", "import os\n\n# read the key\ndef key():\n    return os.environ['API_KEY']"],
  ])("%s pastes as text: its # lines are comments", (_name, code) => {
    expect(looksLikeMarkdown(code)).toBe(false);
    expect(pasteThenCopy(code)).toBe(code);
  });

  it("markdown with headings standing apart, or on a list, still converts", () => {
    expect(looksLikeMarkdown("# Title\n\nSome text")).toBe(true);
    expect(looksLikeMarkdown("## Steps\n1. Draft\n2. Ship")).toBe(true);
    expect(looksLikeMarkdown("## Keys\n- a\n- b\n\n## Notes\n> quoted")).toBe(true);
    const doc = "## Setup\n\n```bash\n# install\nnpm i\n```";
    expect(looksLikeMarkdown(doc)).toBe(true);
    expect(blockTypes(pastedEditor(doc))).toEqual(["heading", "code"]);
  });

  it("list numbers stay as typed", () => {
    expect(pasteThenCopy("3. Install\n7. Deploy")).toBe("3. Install\n7. Deploy");
    expect(pasteThenCopy("1. a\n1. b\n1. c")).toBe("1. a\n1. b\n1. c");
    // A list that counts up by one is still a list.
    expect(blockTypes(pastedEditor("1. a\n2. b"))).toEqual(["list"]);
    expect(pasteThenCopy("1. a\n2. b")).toBe("1. a\n2. b");
    expect(pasteThenCopy("5. a\n6. b")).toBe("5. a\n6. b");
  });
});

describe("clipboard fidelity: typed lines copy as lines", () => {
  function typed(...blocks: (string | ["h2", string])[]): LexicalEditor {
    const { editor } = createNotesHeadlessEditor("clipboard-typed");
    editor.update(
      () => {
        for (const block of blocks) {
          const node =
            typeof block === "string" ? $createParagraphNode() : $createHeadingNode("h2");
          const text = typeof block === "string" ? block : block[1];
          if (text !== "") node.append($createTextNode(text));
          $getRoot().append(node);
        }
      },
      { discrete: true },
    );
    return editor;
  }

  it("paragraphs a line apart, as Enter made them", () => {
    expect(copyAll(typed("KEY_ONE=a", "KEY_TWO=b"))).toBe("KEY_ONE=a\nKEY_TWO=b");
    expect(copyAll(typed("a", "", "b"))).toBe("a\n\nb");
  });

  it("a copy holding other blocks is a markdown document", () => {
    expect(copyAll(typed(["h2", "Keys"], "a", "b"))).toBe("## Keys\n\na\n\nb");
  });
});

describe("clipboard fidelity: formatting still copies as markdown", () => {
  function copyOf(md: string): string {
    const { editor } = createNotesHeadlessEditor("clipboard-format");
    editor.update(() => $convertFromMarkdownString(md, NOTES_TRANSFORMERS), { discrete: true });
    return copyAll(editor);
  }

  it("block and format markers stay, the characters inside stay literal", () => {
    expect(copyOf("## Keys\n\n- **sk_live_x** for prod\n- `npm_token` in CI")).toBe(
      "## Keys\n\n- **sk_live_x** for prod\n- `npm_token` in CI",
    );
  });

  it("inline code keeps its backslashes as typed", () => {
    expect(copyOf("run `C:\\a_b\\c`")).toBe("run `C:\\a_b\\c`");
  });

  it("edge spaces of a bold run come back as spaces", () => {
    const { editor } = createNotesHeadlessEditor("clipboard-edge-space");
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append(
          $createTextNode("say "),
          $createTextNode("hi ").toggleFormat("bold"),
          $createTextNode("now"),
        );
        $getRoot().append(p);
      },
      { discrete: true },
    );
    expect(copyAll(editor)).not.toContain("&#");
  });

  it("a selection across two paragraphs copies only what is selected, literally", () => {
    const { editor } = createNotesHeadlessEditor("clipboard-range");
    editor.update(
      () => $convertFromMarkdownString("KEY_ONE=a_b\n\nKEY_TWO=c_d", NOTES_TRANSFORMERS),
      {
        discrete: true,
      },
    );
    let out: string | null = null;
    editor.update(
      () => {
        const [first, second] = $getRoot().getAllTextNodes();
        const sel = $createRangeSelection();
        sel.anchor.set(first!.getKey(), 4, "text");
        sel.focus.set(second!.getKey(), 7, "text");
        $setSelection(sel);
        out = $copyPlainText(sel);
      },
      { discrete: true },
    );
    expect(out).toBe("ONE=a_b\nKEY_TWO");
  });
});
