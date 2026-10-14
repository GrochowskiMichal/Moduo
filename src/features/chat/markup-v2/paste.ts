// Clean paste for the chat composer (CH15: "pasting stays clean text"). What
// comes in from Slack, Google Docs or a web page keeps its text, its lines,
// its links and its block shape (lists, quotes, code blocks) and drops every
// style: bold, italic, underline, colour, font, size, inline code. Dropping
// styles also sidesteps Google Docs' wrapper (`<b style="font-weight:normal"
// id="docs-internal-guid-…">`, which a naive import reads as all-bold). The
// result is a canonical tree; the composer inserts it with `$blocksToNodes`
// (CV-7b wires PASTE_COMMAND). Needs a DOM (`DOMParser`): the app and jsdom.

import { canonicalBlocks, isAllowedHref } from "./canonical";
import type { Block, Inline, TextLeaf } from "./types";

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "P",
  "SECTION",
  "TABLE",
  "TBODY",
  "THEAD",
  "TFOOT",
  "TR",
]);
const SKIP_TAGS = new Set([
  "HEAD",
  "META",
  "LINK",
  "NOSCRIPT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "TITLE",
]);

/** RF-1's chip marker (`ENTITY_REF_ATTR` in spine/references/reference-node.tsx, kept free of React here). */
const ENTITY_REF_ATTR = "data-lexical-entity-ref";

/** Characters a paste never keeps: zero-width spaces and byte-order marks. */
const INVISIBLE = /[\u200b\ufeff]/g;
/** A no-break space (pasted text keeps the space, not the glyph). */
const NBSP = /\u00a0/g;

/** Plain text as the composer would hold it: one paragraph, a line break per line. */
export function plainTextToBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(INVISIBLE, "").replace(NBSP, " ").split("\n");
  const c: Inline[] = [];
  lines.forEach((line, i) => {
    if (i > 0) c.push({ t: "br" });
    if (line) c.push({ t: "text", v: line, m: 0 });
  });
  return canonicalBlocks([{ t: "p", c }]);
}

/** Collects inline content line by line, collapsing whitespace like a browser does. */
class Lines {
  c: Inline[] = [];

  /** The text written so far on the current line ends in a space (or the line is empty). */
  private atSpace(): boolean {
    const last = this.c[this.c.length - 1];
    if (!last || last.t === "br") return true;
    if (last.t === "text") return last.v.endsWith(" ");
    return false;
  }

  text(raw: string, pre: boolean): void {
    let v = raw.replace(INVISIBLE, "");
    if (!pre) {
      v = v.replace(/[ \t\n\r\f]+/g, " ");
      if (this.atSpace()) v = v.replace(/^ /, "");
    }
    v = v.replace(NBSP, " ");
    if (!v) return;
    const last = this.c[this.c.length - 1];
    if (last?.t === "text" && last.m === 0) last.v += v;
    else this.c.push({ t: "text", v, m: 0 });
  }

  push(leaf: Inline): void {
    this.c.push(leaf);
  }

  /** End the current line (a block element's edge): a break unless the line is empty. */
  newline(): void {
    this.trimEnd();
    const last = this.c[this.c.length - 1];
    if (last && last.t !== "br") this.c.push({ t: "br" });
  }

  /** A `<br>`: always a break. */
  br(): void {
    this.trimEnd();
    this.c.push({ t: "br" });
  }

  private trimEnd(): void {
    const last = this.c[this.c.length - 1];
    if (last?.t === "text") {
      last.v = last.v.replace(/ +$/, "");
      if (!last.v) this.c.pop();
    }
  }

  take(): Inline[] {
    this.trimEnd();
    while (this.c[this.c.length - 1]?.t === "br") this.c.pop();
    while (this.c[0]?.t === "br") this.c.shift();
    const out = this.c;
    this.c = [];
    return out;
  }
}

/** The text of a `<pre>` (its `<br>`s as line ends). */
function preText(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) out += (child as Text).data;
    else if (child.nodeName === "BR") out += "\n";
    else if (child.nodeType === 1) {
      out += preText(child);
      if (BLOCK_TAGS.has(child.nodeName) && !out.endsWith("\n")) out += "\n";
    }
  });
  return out;
}

/**
 * RF-1's chips in pasted HTML (what the shared editor puts on the clipboard):
 * the reference or the day, never the chip's text, which may be an old
 * stored title (`reference-node.tsx` exportDOM) or just the type's word.
 */
function chipLeaf(el: Element): Inline | null {
  if (el.nodeName === "SPAN" && el.hasAttribute(ENTITY_REF_ATTR)) {
    return {
      t: "ref",
      type: el.getAttribute("data-entity-type") ?? "",
      id: el.getAttribute("data-entity-id") ?? "",
    };
  }
  if (el.nodeName === "TIME" && el.hasAttribute("data-moduo-date")) {
    return { t: "date", day: el.getAttribute("data-moduo-date") ?? "" };
  }
  return null;
}

/** What an image stands for in text: an emoji's character or `:name:`; nothing else. */
function imageText(img: Element): string {
  const named =
    img.getAttribute("data-stringify-emoji") ?? img.getAttribute("data-stringify-text") ?? "";
  if (/^:[a-z0-9_+-]{1,32}:$/.test(named)) return named;
  const alt = img.getAttribute("alt") ?? "";
  if (/^:[a-z0-9_+-]{1,32}:$/.test(alt) || /^\p{Extended_Pictographic}/u.test(alt)) return alt;
  return "";
}

class Builder {
  blocks: Block[] = [];
  para = new Lines();

  private flush(): void {
    const c = this.para.take();
    if (c.length) this.blocks.push({ t: "p", c });
  }

  /** Inline content of `node` into `lines` (links kept, styles dropped). */
  private inline(node: Node, lines: Lines): void {
    for (const child of Array.from(node.childNodes)) this.inlineNode(child, lines);
  }

  private inlineNode(child: Node, lines: Lines): void {
    if (child.nodeType === 3) {
      lines.text((child as Text).data, false);
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.nodeName;
    if (SKIP_TAGS.has(tag)) return;
    const chip = chipLeaf(el);
    if (chip) {
      lines.push(chip);
      return;
    }
    if (tag === "BR") {
      lines.br();
      return;
    }
    if (tag === "IMG") {
      lines.text(imageText(el), false);
      return;
    }
    if (tag === "A") {
      this.link(el, lines);
      return;
    }
    if (tag === "UL" || tag === "OL" || tag === "PRE" || tag === "BLOCKQUOTE") {
      // A block inside inline content (a list in a quote, a list in an item): its lines.
      lines.newline();
      if (tag === "PRE") {
        preText(el)
          .replace(/\n$/, "")
          .split("\n")
          .forEach((line, i) => {
            if (i > 0) lines.br();
            lines.text(line, true);
          });
      } else {
        this.inline(el, lines);
      }
      lines.newline();
      return;
    }
    if (tag === "TD" || tag === "TH") {
      this.cell(el, lines);
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) lines.newline();
    this.inline(el, lines);
    if (block) lines.newline();
  }

  /** A table cell: its text on the row's line, after a tab when it isn't the first. */
  private cell(el: Element, lines: Lines): void {
    if (el.previousElementSibling) lines.text("\t", true);
    const inner = new Lines();
    this.inline(el, inner);
    for (const leaf of inner.take()) {
      if (leaf.t === "br") lines.text(" ", false);
      else if (leaf.t === "text") lines.text(leaf.v, false);
      else lines.push(leaf);
    }
  }

  /** A link: kept when its target is http(s) or mailto and its text says something else. */
  private link(el: Element, lines: Lines): void {
    const href = (el.getAttribute("href") ?? "").trim();
    const label = new Lines();
    this.inline(el, label);
    const c = label.take().filter((leaf): leaf is TextLeaf => leaf.t === "text");
    const text = c.map((leaf) => leaf.v).join("");
    if (!isAllowedHref(href) || !text || text === href || `mailto:${text}` === href) {
      lines.text(text, false);
      return;
    }
    lines.push({ t: "link", href, c });
  }

  private list(el: Element): void {
    this.flush();
    const items: Inline[][] = [];
    const collect = (list: Element) => {
      for (const li of Array.from(list.children)) {
        if (li.nodeName !== "LI") continue;
        const lines = new Lines();
        const nested: Element[] = [];
        li.childNodes.forEach((child) => {
          if (child.nodeName === "UL" || child.nodeName === "OL") nested.push(child as Element);
        });
        // The item's own content, without its nested lists (they follow, one level up).
        const clone = li.cloneNode(true) as Element;
        for (const sub of Array.from(clone.children)) {
          if (sub.nodeName === "UL" || sub.nodeName === "OL") sub.remove();
        }
        this.inline(clone, lines);
        items.push(lines.take());
        for (const sub of nested) collect(sub);
      }
    };
    collect(el);
    const ordered = el.nodeName === "OL";
    const start = Number(el.getAttribute("start") ?? "1");
    this.blocks.push({ t: "list", ordered, start: Number.isFinite(start) ? start : 1, items });
  }

  walk(node: Node): void {
    for (const child of Array.from(node.childNodes)) this.walkNode(child);
  }

  private walkNode(child: Node): void {
    if (child.nodeType === 3) {
      this.para.text((child as Text).data, false);
      return;
    }
    if (child.nodeType !== 1) return;
    const el = child as Element;
    const tag = el.nodeName;
    if (SKIP_TAGS.has(tag)) return;
    const chip = chipLeaf(el);
    if (chip) {
      this.para.push(chip);
      return;
    }
    if (tag === "UL" || tag === "OL") {
      this.list(el);
      return;
    }
    if (tag === "PRE") {
      this.flush();
      this.blocks.push({ t: "pre", v: preText(el).replace(/\n$/, ""), lang: null });
      return;
    }
    if (tag === "BLOCKQUOTE") {
      this.flush();
      const lines = new Lines();
      this.inline(el, lines);
      this.blocks.push({ t: "quote", c: lines.take() });
      return;
    }
    if (tag === "BR") this.para.br();
    else if (tag === "IMG") this.para.text(imageText(el), false);
    else if (tag === "A") this.link(el, this.para);
    else if (tag === "TD" || tag === "TH") this.cell(el, this.para);
    else {
      const block = BLOCK_TAGS.has(tag);
      if (block) this.para.newline();
      this.walk(el);
      if (block) this.para.newline();
    }
  }

  done(): Block[] {
    this.flush();
    return canonicalBlocks(this.blocks);
  }
}

/** Pasted HTML as a canonical tree: text, lines, links, lists, quotes and code blocks. */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const builder = new Builder();
  builder.walk(doc.body);
  return builder.done();
}

/** What a paste brings: the HTML when there is some, else the plain text. */
export function pastedBlocks(data: { html?: string | null; text?: string | null }): Block[] {
  if (data.html?.trim()) return htmlToBlocks(data.html);
  return plainTextToBlocks(data.text ?? "");
}
