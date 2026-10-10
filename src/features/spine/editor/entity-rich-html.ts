// Connective-tissue spine — DF-23 rich-description HTML helpers (pure, no DOM).
//
// The task/event `description` column is one field shared by two producers:
// user-authored rich text (our Lexical editor's HTML, carrying inline
// `EntityRefNode` chips) AND plain text from external sync (Google/Graph/ICS
// mirrors, legacy pre-Lexical rows). We must render OUR html richly while
// leaving foreign/legacy plain text exactly as before (incl. literal `<…>` that
// must NOT be parsed as markup). Since there's no format column, we distinguish
// by shape — and it holds because our editor only ever emits block-wrapped HTML.

/** Block tags our editor emits at the top level (`$generateHtmlFromNodes`
 * always wraps content in these). Foreign plain text — even "<https://…>" or
 * "x < y" — does not start with one, so it stays plain. Kept to tags the
 * read-side walker preserves structurally (no `pre`/`br`), so a matched string
 * is always rendered whole rather than partly flattened. */
const RICH_HTML_PREFIX = /^\s*<(p|ul|ol|li|div|h[1-6]|blockquote)\b/i;

/** Our chip marker (see `entity-ref-node.tsx`). */
const CHIP_MARKER = "data-lexical-entity-ref";
/** A date chip's marker (references/date-node.tsx). */
const DATE_MARKER = "data-moduo-date";

/**
 * True when `value` is our editor's HTML (render/parse as markup); false for
 * foreign or legacy plain text (render verbatim). Conservative on purpose: a
 * false negative merely shows our html as escaped text, never the reverse
 * (foreign text is never parsed as markup) — so untrusted mirror data can't
 * smuggle in an element.
 */
export function looksLikeRichHtml(value: string): boolean {
  if (!value) return false;
  return value.includes(CHIP_MARKER) || value.includes(DATE_MARKER) || RICH_HTML_PREFIX.test(value);
}

/**
 * Strip the chip's internal address attributes, leaving `<span>Label</span>`.
 * Applied to outgoing email HTML so we never leak Moduo entity ids to an
 * external recipient (the visible label is preserved).
 */
export function stripEntityRefAttrs(html: string): string {
  return html.replace(
    /\s+data-(?:lexical-entity-ref|entity-type|entity-id|entity-icon|display|ref-v)="[^"]*"/g,
    "",
  );
}
