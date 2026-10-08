// Headless proof that the compose editor's node set (email-compose-editor.tsx)
// round-trips reply formatting through HTML — the core of the Lexical rebuild. Runs
// the exact seed (HTML → nodes) + export (nodes → HTML / plain text) the plugins do,
// without a browser, so a dropped node (bold/list/link/quote) is caught in CI.

import { createHeadlessEditor } from "@lexical/headless";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { describe, expect, it } from "@rstest/core";
import { $createParagraphNode, $getRoot, $insertNodes } from "lexical";

function roundTrip(html: string): { html: string; text: string } {
  const editor = createHeadlessEditor({
    namespace: "email-compose-test",
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode],
    onError: (e) => {
      throw e;
    },
  });

  // Seed (mirrors SeedHtmlPlugin).
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const anchor = $createParagraphNode();
      root.append(anchor);
      anchor.select();
      const dom = new DOMParser().parseFromString(html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      if (nodes.length) $insertNodes(nodes);
    },
    { discrete: true },
  );

  // Export (mirrors ExportPlugin).
  let out = { html: "", text: "" };
  editor.getEditorState().read(() => {
    out = {
      html: $generateHtmlFromNodes(editor, null),
      text: $getRoot().getTextContent(),
    };
  });
  return out;
}

describe("compose editor HTML round-trip", () => {
  it("preserves bold, a bulleted list, and a link", () => {
    const { html, text } = roundTrip(
      "<p>Hi <strong>there</strong></p><ul><li>one</li><li>two</li></ul>" +
        '<p><a href="https://example.com">a link</a></p>',
    );
    // Lexical exports bold as `<b><strong style=…>there</strong></b>` — a valid
    // bold that mail clients render; just assert the semantic tag survives.
    expect(html).toMatch(/<strong[^>]*>there<\/strong>/);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li"); // `<li value="1">`
    expect(html).toContain("https://example.com");
    // Plain-text alternative carries the readable content.
    expect(text).toContain("there");
    expect(text).toContain("one");
    expect(text).toContain("a link");
  });

  it("preserves a quoted reply (blockquote)", () => {
    const { html } = roundTrip("<p>my reply</p><blockquote>original text</blockquote>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("original text");
  });
});
