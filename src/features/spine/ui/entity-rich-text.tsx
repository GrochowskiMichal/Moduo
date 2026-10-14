// Connective-tissue spine — DF-23 read-only renderer for entity-rich text.
//
// Renders a stored `description` (task / calendar event) that MAY carry inline
// references and date chips, as read-only React: plain text stays plain
// (verbatim, `whitespace-pre-wrap`, matching the old <Textarea>-mirror), our
// HTML walks to text + References (RF-1: live, per reader, "Private item" when
// the reader can't open it) + date chips. A stored chip's old label is never
// shown inside the app shell: the reference resolves what the reader may see.
//
// XSS posture: this NEVER uses `dangerouslySetInnerHTML`. It DOMParses into an
// inert document (no script execution) and emits ONLY text, `<br>`, list/para
// wrappers, and recognized chip spans — every other element is flattened to its
// text and every attribute is dropped. So even the calendar column's untrusted
// external-mirror data (which also flows through here) cannot inject markup.
// Relative imports only (no `@/` value imports — this file is test-reachable).

import { type ReactNode, useMemo } from "react";
import { cn } from "../../../lib/utils";
import { looksLikeRichHtml } from "../editor/entity-rich-html";
import { isReferenceDisplay } from "../references/types";
import { DateChip } from "../references/ui/date-chip";
import { Reference } from "../references/ui/reference";

// Elements dropped whole (content and all) — never rendered, never flattened.
const DROP = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "LINK",
  "META",
  "HEAD",
]);
// Block wrappers we preserve structurally; everything else inline is flattened.
const BLOCK = new Set(["P", "DIV", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"]);

function walk(parent: Node, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  parent.childNodes.forEach((child, i) => {
    const key = `${keyPrefix}.${i}`;
    if (child.nodeType === 3 /* TEXT_NODE */) {
      const text = child.textContent ?? "";
      if (text) out.push(text);
      return;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = child as HTMLElement;
    // Uppercase so the DROP/BLOCK checks also catch foreign (SVG/MathML)
    // elements, whose `tagName` preserves the authored (often lower) case.
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) return;

    // A reference → the live Reference. A malformed marker renders nothing: its
    // text may be a stored title the reader can't be shown.
    if (el.hasAttribute("data-lexical-entity-ref")) {
      const type = el.getAttribute("data-entity-type") ?? "";
      const id = el.getAttribute("data-entity-id") ?? "";
      const display = el.getAttribute("data-display");
      // A label-less reference (data-ref-v) holds only the type's word.
      const label = el.hasAttribute("data-ref-v") ? null : el.textContent;
      if (type && id) {
        out.push(
          <Reference
            key={key}
            type={type}
            id={id}
            display={isReferenceDisplay(display) ? display : "chip"}
            fallbackLabel={label}
          />,
        );
      }
      return;
    }

    // A date chip.
    if (tag === "TIME" && el.hasAttribute("data-moduo-date")) {
      const day = el.getAttribute("data-moduo-date") ?? "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) out.push(<DateChip key={key} day={day} />);
      else out.push(el.textContent ?? "");
      return;
    }

    if (tag === "BR") {
      out.push(<br key={key} />);
      return;
    }
    if (tag === "UL") {
      out.push(
        <ul key={key} className="list-disc pl-5">
          {walk(el, key)}
        </ul>,
      );
      return;
    }
    if (tag === "OL") {
      out.push(
        <ol key={key} className="list-decimal pl-5">
          {walk(el, key)}
        </ol>,
      );
      return;
    }
    if (tag === "LI") {
      out.push(<li key={key}>{walk(el, key)}</li>);
      return;
    }
    if (BLOCK.has(tag)) {
      out.push(<p key={key}>{walk(el, key)}</p>);
      return;
    }
    // Inline / unknown (span, b, i, a, …): keep the text, drop the tag + attrs.
    out.push(...walk(el, key));
  });
  return out;
}

function renderRichHtml(html: string): ReactNode[] {
  if (typeof DOMParser === "undefined") return [html];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return walk(doc.body, "r");
}

export type EntityRichTextProps = {
  /** The stored description — our HTML (with chips) or foreign/legacy plain text. */
  html: string;
  className?: string;
};

/**
 * Read-only display of an entity-rich description. Plain text renders verbatim;
 * our HTML renders as text + clickable entity chips. Callers guard emptiness
 * themselves (render nothing / an em-dash when there's no description).
 */
export function EntityRichText({ html, className }: EntityRichTextProps) {
  const rich = useMemo(() => (looksLikeRichHtml(html) ? renderRichHtml(html) : null), [html]);
  if (rich === null) {
    return <div className={cn("whitespace-pre-wrap", className)}>{html}</div>;
  }
  return <div className={cn("space-y-2", className)}>{rich}</div>;
}
