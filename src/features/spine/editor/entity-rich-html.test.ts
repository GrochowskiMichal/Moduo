// DF-23 — the shape heuristic that lets ONE `description` column hold both our
// rich html (parse as markup) and foreign/legacy plain text (render verbatim),
// plus the outgoing-email attribute scrub.
import { describe, expect, it } from "vitest";
import { looksLikeRichHtml, stripEntityRefAttrs } from "./entity-rich-html";

describe("looksLikeRichHtml", () => {
  it("is false for empty, plain, and foreign text with literal angle brackets", () => {
    expect(looksLikeRichHtml("")).toBe(false);
    expect(looksLikeRichHtml("just a note")).toBe(false);
    // Untrusted mirror data must never be mistaken for markup.
    expect(looksLikeRichHtml("x < y and z")).toBe(false);
    expect(looksLikeRichHtml("<https://example.com>")).toBe(false);
    expect(looksLikeRichHtml("<b>inline, not a block</b>")).toBe(false);
    // Only tags the walker preserves whole count — not `<br>`/`<pre>`.
    expect(looksLikeRichHtml("<br>a line")).toBe(false);
  });

  it("is true for our block-wrapped html and for chip markers", () => {
    expect(looksLikeRichHtml("<p>hello</p>")).toBe(true);
    expect(looksLikeRichHtml("  <ul><li>x</li></ul>")).toBe(true);
    expect(looksLikeRichHtml('<span data-lexical-entity-ref="true">Acme</span>')).toBe(true);
  });
});

describe("stripEntityRefAttrs", () => {
  it("removes the internal entity address, keeping the visible label span", () => {
    const html =
      '<p>Hi <span data-lexical-entity-ref="true" data-entity-type="contact" data-entity-id="c-1" data-entity-icon="user">Acme</span></p>';
    const out = stripEntityRefAttrs(html);
    expect(out).toBe("<p>Hi <span>Acme</span></p>");
    expect(out).not.toContain("data-entity-id");
    expect(out).not.toContain("data-lexical-entity-ref");
  });

  it("leaves html without chips untouched", () => {
    const html = "<p>plain <b>body</b></p>";
    expect(stripEntityRefAttrs(html)).toBe(html);
  });
});
