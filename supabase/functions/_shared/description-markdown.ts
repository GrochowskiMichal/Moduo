/**
 * A task's description as Markdown (dogfood call #15, MOD-98 / MOD-120).
 *
 * Descriptions are stored as plain Markdown. Older ones are the HTML the
 * description editor used to save (`<p class="mb-2 last:mb-0"><span
 * style="white-space: pre-wrap;">…</span></p>`); nothing converts them in
 * bulk. Whatever reads a description turns that HTML into Markdown here, in
 * memory, and the app saves Markdown the next time the description changes.
 *
 * References are Markdown links to the app's URI (the form Notes and comments
 * already use, `references/text.ts`), labelled with the item's kind, never its
 * title (RF-1): `[task](moduo://task/<id>)`. How it shows, when not a chip, is
 * the link's title: `[note](moduo://note/<id> "card")`. A date chip is
 * `[Oct 17](moduo://date/2026-10-17)`; only the day counts.
 *
 * Pure: no DOM, no Deno or Supabase imports, so the connector (Deno) and the
 * app (search, card previews, the editor's seed) run the same code.
 */

/** How a reference shows in text (references/types.ts). */
export type DescriptionDisplay = "link" | "chip" | "card";

const DISPLAYS: readonly DescriptionDisplay[] = ["link", "chip", "card"];

/** A reference or a date chip written as a Markdown link (label, type, id, display). */
export const DESCRIPTION_LINK =
  /\[([^\]\n]*)\]\(moduo:\/\/([a-z][a-z_-]*)\/([A-Za-z0-9-]+)(?:\s+"(link|chip|card)")?\)/;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The word a reference is labelled with: its kind, never its title. Mirrors
 *  `referenceNoun(referenceKind(type))` in the app (a test keeps them equal). */
const WORDS: Record<string, string> = {
  task: "task",
  email: "email",
  email_thread: "email",
  contact: "contact",
  company: "company",
  note: "note",
  event: "event",
  project: "project",
  bucket: "project",
  tag: "tag",
};

export function referenceWord(type: string): string {
  return WORDS[type] ?? "item";
}

/** A reference as the description stores it. A chip (the default) has no title. */
export function referenceMarkdown(type: string, id: string, display?: string | null): string {
  const shown = display && display !== "chip" && DISPLAYS.includes(display as DescriptionDisplay);
  return `[${referenceWord(type)}](moduo://${type}/${id}${shown ? ` "${display}"` : ""})`;
}

/** The items a description references, each once, in order (date chips aren't items). */
export function descriptionReferences(value: string | null | undefined): Array<{ type: string; id: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; id: string }> = [];
  for (const m of descriptionToMarkdown(value).matchAll(new RegExp(DESCRIPTION_LINK.source, "g"))) {
    const [, , type, id] = m;
    if (!type || !id || type === "date" || seen.has(`${type}:${id}`)) continue;
    seen.add(`${type}:${id}`);
    out.push({ type, id });
  }
  return out;
}

/** A date chip as the description stores it; the label is for people reading the raw text. */
export function dateMarkdown(day: string, label: string): string {
  return `[${label.replace(/[[\]\n]/g, "") || day}](moduo://date/${day})`;
}

/**
 * The editor's HTML (what descriptions were before Markdown), told apart from
 * Markdown by its first tag. `<https://…>` is a Markdown autolink, not HTML,
 * so a bare "starts with <" isn't enough.
 */
const HTML_START =
  /^\s*<(?:p|div|ul|ol|li|blockquote|h[1-6]|pre|span|br|b|strong|i|em|u|s|del|code|a|time)(?=[\s/>])/i;

export function isHtmlDescription(value: string | null | undefined): boolean {
  return typeof value === "string" && HTML_START.test(value);
}

/**
 * Markdown that would read as the old HTML (a description starting with the
 * words "<span> wraps wrong") keeps its first `<` escaped, so the next read
 * doesn't parse it as markup. `\<` is plain Markdown for "<".
 */
export function guardMarkdownStart(markdown: string): string {
  return isHtmlDescription(markdown) ? markdown.replace(/^(\s*)</, "$1\\<") : markdown;
}

/** Any stored description as Markdown: the old HTML converted, Markdown as it is. */
export function descriptionToMarkdown(value: string | null | undefined): string {
  if (!value) return "";
  return isHtmlDescription(value) ? htmlToMarkdown(value) : value;
}

/**
 * The first `max` characters of a description's Markdown, never ending in
 * half a link (an agent would read `[task](moduo://task/1f3a` as a broken
 * reference): a link the cut runs through is left out whole.
 */
export function markdownExcerpt(markdown: string, max: number): string {
  if (markdown.length <= max) return markdown;
  const cut = markdown.slice(0, max);
  const open = cut.lastIndexOf("[");
  if (open >= 0 && /^\[[^\]\n]*(?:\]\([^)\n]*)?$/.test(cut.slice(open))) return cut.slice(0, open).trimEnd();
  return cut;
}

// ── HTML → Markdown ───────────────────────────────────────────────────────

type El = { tag: string; attrs: Record<string, string>; children: Node[] };
type Node = El | string;

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "wbr", "col", "source"]);
const BR: El = { tag: "br", attrs: {}, children: [] };
/** Dropped whole, content and all. */
const DROP = new Set(["script", "style", "noscript", "iframe", "object", "embed", "template", "head"]);
const BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "ul", "ol"]);

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** A forgiving parse of the editor's HTML into a small tree. */
function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text) stack[stack.length - 1].children.push(decodeEntities(text));
    text = "";
  };
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      if (html.startsWith("<!--", i)) {
        flush();
        const end = html.indexOf("-->", i + 4);
        i = end < 0 ? html.length : end + 3;
        continue;
      }
      const m = TAG.exec(html.slice(i));
      if (m) {
        flush();
        const [whole, closing, rawName, rawAttrs, selfClose] = m;
        const name = rawName.toLowerCase();
        if (closing) {
          // Close the nearest open element of that name (and anything left open inside it).
          for (let k = stack.length - 1; k > 0; k--) {
            if (stack[k].tag === name) {
              stack.length = k;
              break;
            }
          }
        } else {
          const attrs: Record<string, string> = {};
          for (const a of rawAttrs.matchAll(ATTR)) {
            attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
          }
          const el: El = { tag: name, attrs, children: [] };
          stack[stack.length - 1].children.push(el);
          if (!VOID.has(name) && !selfClose) stack.push(el);
        }
        i += whole.length;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  flush();
  return root;
}

type Format = { bold: boolean; italic: boolean; strike: boolean; code: boolean };
const PLAIN: Format = { bold: false, italic: false, strike: false, code: false };

/** What an inline element adds to the formats around it (tags, Lexical's theme classes, styles). */
function formatOf(el: El, base: Format): Format {
  const cls = ` ${el.attrs.class ?? ""} `;
  const style = (el.attrs.style ?? "").toLowerCase();
  const t = el.tag;
  return {
    bold:
      base.bold ||
      t === "b" ||
      t === "strong" ||
      /\sfont-(?:semibold|bold)\s/.test(cls) ||
      /font-weight:\s*(?:bold|[6-9]00)/.test(style),
    italic: base.italic || t === "i" || t === "em" || /\sitalic\s/.test(cls) || /font-style:\s*italic/.test(style),
    strike:
      base.strike ||
      t === "s" ||
      t === "del" ||
      t === "strike" ||
      /\sline-through\s/.test(cls) ||
      /text-decoration[^;]*line-through/.test(style),
    code: base.code || t === "code",
  };
}

/** A run of words with its formats, or Markdown that goes out as it is. */
type Run = { text: string; format: Format } | { raw: string };

/** Escape what Markdown would read as formatting (the editor's exporter escapes the same). */
function escapeText(text: string): string {
  return text.replace(/([*_`~\\])/g, "\\$1");
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function sameFormat(a: Format, b: Format): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.strike === b.strike && a.code === b.code;
}

function wrap(text: string, f: Format): string {
  if (!text) return "";
  // Markers hug the words; the spaces around them stay outside.
  const [, lead, body, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? ["", "", text, ""];
  if (!body) return text;
  let out = f.code ? codeSpan(body) : escapeText(body);
  if (f.strike) out = `~~${out}~~`;
  if (f.italic) out = `*${out}*`;
  if (f.bold) out = `**${out}**`;
  return `${lead}${out}${trail}`;
}

function runsToMarkdown(runs: Run[]): string {
  let out = "";
  let pending: { text: string; format: Format } | null = null;
  const flush = () => {
    if (pending) out += wrap(pending.text, pending.format);
    pending = null;
  };
  for (const run of runs) {
    if ("raw" in run) {
      flush();
      out += run.raw;
      continue;
    }
    if (pending && sameFormat(pending.format, run.format)) pending.text += run.text;
    else {
      flush();
      pending = { text: run.text, format: run.format };
    }
  }
  flush();
  return out;
}

function textContent(node: Node): string {
  return typeof node === "string" ? node : node.children.map(textContent).join("");
}

function linkUrl(href: string): string {
  return /[\s<>]/.test(href) ? `<${href.replace(/[<>]/g, "")}>` : href.replace(/([()\\])/g, "\\$1");
}

/** The inline content of an element as runs. */
function inlineRuns(nodes: Node[], format: Format, out: Run[] = []): Run[] {
  for (const node of nodes) {
    if (typeof node === "string") {
      // Source line breaks inside the HTML are whitespace; <br> is the break.
      if (node) out.push({ text: node.replace(/\s*\n\s*/g, " "), format });
      continue;
    }
    const tag = node.tag;
    if (DROP.has(tag)) continue;
    if (tag === "br") {
      out.push({ raw: "\n" });
      continue;
    }
    if ("data-lexical-entity-ref" in node.attrs) {
      // A reference: its address only, never its old label (RF-1). One
      // without an address can't resolve, and its text may be a title.
      const type = node.attrs["data-entity-type"] ?? "";
      const id = node.attrs["data-entity-id"] ?? "";
      if (/^[a-z][a-z_-]*$/.test(type) && /^[A-Za-z0-9-]+$/.test(id)) {
        out.push({ raw: referenceMarkdown(type, id, node.attrs["data-display"]) });
      }
      continue;
    }
    if (tag === "time" && "data-moduo-date" in node.attrs) {
      const day = node.attrs["data-moduo-date"] ?? "";
      if (ISO_DAY.test(day)) out.push({ raw: dateMarkdown(day, textContent(node).trim()) });
      else out.push({ text: textContent(node), format });
      continue;
    }
    if (tag === "a" && node.attrs.href) {
      const label = runsToMarkdown(inlineRuns(node.children, PLAIN)).replace(/([[\]])/g, "\\$1");
      out.push({ raw: `[${label || escapeText(node.attrs.href)}](${linkUrl(node.attrs.href)})` });
      continue;
    }
    inlineRuns(node.children, formatOf(node, format), out);
  }
  return out;
}

function inlineMarkdown(nodes: Node[]): string {
  return runsToMarkdown(inlineRuns(nodes, PLAIN))
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

function isBlock(node: Node): node is El {
  return typeof node !== "string" && (BLOCKS.has(node.tag) || node.tag === "li");
}

/** A list as Markdown lines, items indented under their parents. */
function listMarkdown(list: El, indent: string): string[] {
  const ordered = list.tag === "ol";
  let n = Number.parseInt(list.attrs.start ?? "1", 10);
  if (!Number.isFinite(n)) n = 1;
  const lines: string[] = [];
  for (const item of list.children) {
    if (typeof item === "string" || item.tag !== "li") {
      // A stray list inside a list (no <li> around it) nests under the last item.
      if (typeof item !== "string" && (item.tag === "ul" || item.tag === "ol")) {
        lines.push(...listMarkdown(item, `${indent}  `));
      }
      continue;
    }
    const isList = (c: Node): c is El => typeof c !== "string" && (c.tag === "ul" || c.tag === "ol");
    const nested = item.children.filter(isList);
    // An item's own paragraphs (`<li><p>…</p></li>`) are lines of the item.
    const inline = item.children
      .filter((c) => !isList(c))
      .flatMap((c) => (typeof c !== "string" && isBlock(c) ? [...c.children, BR] : [c]));
    const text = inlineMarkdown(inline);
    const marker = ordered ? `${n}. ` : "- ";
    const checked = item.attrs["aria-checked"];
    const box = item.attrs.role === "checkbox" || checked !== undefined ? (checked === "true" ? "[x] " : "[ ] ") : "";
    if (text || box) {
      const [first, ...rest] = text.split("\n");
      lines.push(`${indent}${marker}${box}${first}`);
      for (const line of rest) lines.push(`${indent}${" ".repeat(marker.length)}${line}`);
      n += 1;
    }
    for (const sub of nested) lines.push(...listMarkdown(sub, `${indent}${" ".repeat(marker.length)}`));
  }
  return lines;
}

/** Block content as Markdown blocks (joined with a blank line). */
function blocksMarkdown(nodes: Node[]): string[] {
  const blocks: string[] = [];
  let inline: Node[] = [];
  const flushInline = () => {
    const text = inlineMarkdown(inline);
    if (text) blocks.push(text);
    inline = [];
  };
  for (const node of nodes) {
    // Words and inline elements between blocks gather into a paragraph.
    if (!isBlock(node)) {
      inline.push(node);
      continue;
    }
    flushInline();
    if (node.tag === "ul" || node.tag === "ol") {
      const lines = listMarkdown(node, "");
      if (lines.length) blocks.push(lines.join("\n"));
    } else if (node.tag === "blockquote") {
      const inner = blocksMarkdown(node.children).join("\n\n");
      if (inner) blocks.push(inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"));
    } else if (node.tag === "li") {
      const text = inlineMarkdown(node.children);
      if (text) blocks.push(`- ${text}`);
    } else {
      // p, div, h1–h6, pre: a paragraph (a div holding blocks is read through).
      if (node.children.some(isBlock)) blocks.push(...blocksMarkdown(node.children));
      else {
        const text = inlineMarkdown(node.children);
        if (text) blocks.push(text);
      }
    }
  }
  flushInline();
  return blocks;
}

/** The editor's old HTML as Markdown: paragraphs, line breaks, formats, lists, links, references, dates. */
export function htmlToMarkdown(html: string): string {
  return guardMarkdownStart(blocksMarkdown(parseHtml(html).children).join("\n\n"));
}

// ── Markdown → words ──────────────────────────────────────────────────────

const ANY_LINK = /!?\[([^\]\n]*)\]\((?:<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)/g;

/**
 * A description's words as people read them, from either form: references
 * left out (their label is only a kind, and a reader may not see the item),
 * a date chip as its date, a link as its text, and no Markdown symbols. For
 * search and the Board card's preview.
 */
export function descriptionPlainText(value: string | null | undefined): string {
  const md = descriptionToMarkdown(value);
  if (!md) return "";
  return md
    .split("\n")
    .map((line) =>
      line
        // Quotes, list markers and checkboxes at the line's start.
        .replace(/^\s*(?:>\s?)+/, "")
        .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]?\]\s+)?/, "")
        .replace(/^\s*\[[ xX]?\]\s+/, ""),
    )
    .join("\n")
    .replace(new RegExp(DESCRIPTION_LINK.source, "g"), (_m, label: string, type: string, id: string) =>
      type === "date" && ISO_DAY.test(id) ? label : " ",
    )
    .replace(ANY_LINK, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    // Emphasis markers (unescaped): ** __ ~~ around words, a single * even
    // inside a word, a single _ only at a word's edge (snake_case stays).
    .replace(/(^|[^\\])(\*\*|__|~~)(?=\S)([^\n]*?\S)\2/g, "$1$3")
    .replace(/(^|[^\\*])\*(?=[^\s*])([^*\n]*?[^\s\\*])\*/g, "$1$2")
    .replace(/(^|[^\w\\])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1");
}
