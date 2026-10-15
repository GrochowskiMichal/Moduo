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
 *
 * It reads stored text anyone in a workspace can write, inside an Edge
 * Function, so a crafted description must never stall it: the HTML is
 * scanned by hand in one pass (no regex over the whole input), nesting is
 * capped, only the first CONVERT_LIMIT characters are converted (the rest
 * follows as plain words), and every regex left has no nested or overlapping
 * quantifiers and stops at the next character that could start a new match.
 */

/** How a reference shows in text (references/types.ts). */
export type DescriptionDisplay = "link" | "chip" | "card";

const DISPLAYS: readonly DescriptionDisplay[] = ["link", "chip", "card"];

/**
 * A reference or a date chip written as a Markdown link (label, type, id,
 * display). The label can't hold `[`, so a run of `[` costs one short scan
 * each, never a scan to the end of the line.
 */
export const DESCRIPTION_LINK =
  /\[([^[\]\n]*)\]\(moduo:\/\/([a-z][a-z_-]*)\/([A-Za-z0-9-]+)(?: "(link|chip|card)")?\)/;

/** How much of a description is converted (or read for its words); the rest follows as plain text. */
export const CONVERT_LIMIT = 50_000;

/** How deep the HTML may nest; deeper tags are read as part of their parent. */
const MAX_DEPTH = 64;

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
  if (open >= 0 && /^\[[^[\]\n]*(?:\]\([^)\n]*)?$/.test(cut.slice(open))) {
    return cut.slice(0, open).trimEnd();
  }
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
const ENTITY_REF = "data-lexical-entity-ref";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** `&amp;`, `&#8212;`, `&#x2014;` → their characters (each `&` costs one short scan). */
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]{1,8}|#\d{1,8}|[a-z]{1,10});/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";
}

/** A tag's attributes, scanned by hand (`name`, `name=value`, `name="value"`). */
function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isSpace(s[i]) || s[i] === "/")) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !isSpace(s[i]) && s[i] !== "=" && s[i] !== "/") i++;
    const name = s.slice(start, i).toLowerCase();
    while (i < n && isSpace(s[i])) i++;
    let value = "";
    if (s[i] === "=") {
      i++;
      while (i < n && isSpace(s[i])) i++;
      const quote = s[i];
      if (quote === '"' || quote === "'") {
        const end = s.indexOf(quote, i + 1);
        const stop = end < 0 ? n : end;
        value = s.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const from = i;
        while (i < n && !isSpace(s[i])) i++;
        value = s.slice(from, i);
      }
    }
    if (name) attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/**
 * A forgiving parse of the editor's HTML into a small tree, in one pass: each
 * `<` is a tag only when a `>` follows before the next `<` (the next of each
 * is remembered, so a run of `<` never rescans the text), comments are
 * skipped, and nesting past MAX_DEPTH stays in its parent.
 */
function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const n = html.length;
  // The next `<` / `>` at or after a position, remembered (-2: not looked yet; -1: none).
  let ltAt = -2;
  let gtAt = -2;
  const nextLt = (from: number) => {
    if (ltAt === -2 || (ltAt !== -1 && ltAt < from)) ltAt = html.indexOf("<", from);
    return ltAt;
  };
  const nextGt = (from: number) => {
    if (gtAt === -2 || (gtAt !== -1 && gtAt < from)) gtAt = html.indexOf(">", from);
    return gtAt;
  };
  let textFrom = 0;
  const text = (end: number) => {
    if (end > textFrom) stack[stack.length - 1].children.push(decodeEntities(html.slice(textFrom, end)));
  };
  let i = 0;
  while (i < n) {
    const lt = nextLt(i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      text(lt);
      const end = html.indexOf("-->", lt + 4);
      // An unclosed comment runs to the end.
      i = end < 0 ? n : end + 3;
      textFrom = i;
      continue;
    }
    const gt = nextGt(lt + 1);
    if (gt < 0) break; // no `>` left: the rest is words
    const after = nextLt(lt + 1);
    const body = after >= 0 && after < gt ? null : html.slice(lt + 1, gt);
    const closing = body?.startsWith("/") ?? false;
    const nameMatch = body ? /^\/?([a-zA-Z][a-zA-Z0-9-]{0,30})(?=[\s/]|$)/.exec(body) : null;
    if (!body || !nameMatch) {
      // A `<` that opens no tag is a word.
      i = lt + 1;
      continue;
    }
    text(lt);
    const name = nameMatch[1].toLowerCase();
    if (closing) {
      // Close the nearest open element of that name (and anything left open inside it).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name) {
          stack.length = k;
          break;
        }
      }
    } else {
      const el: El = { tag: name, attrs: parseAttrs(body.slice(nameMatch[0].length)), children: [] };
      stack[stack.length - 1].children.push(el);
      if (!VOID.has(name) && !body.endsWith("/") && stack.length <= MAX_DEPTH) stack.push(el);
    }
    i = gt + 1;
    textFrom = i;
  }
  text(n);
  return root;
}

/**
 * The words of HTML past CONVERT_LIMIT, in one pass: tags dropped, a
 * reference's stored text dropped with it (it may be a title, RF-1), entities
 * decoded, escaped as Markdown text.
 */
function htmlWords(html: string): string {
  let out = "";
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break;
    const tag = html.slice(lt, gt + 1);
    i = gt + 1;
    if (tag.includes(ENTITY_REF)) {
      const close = html.indexOf("</span", i);
      i = close < 0 ? n : close;
    } else if (/^<\/?(?:p|div|li|br|blockquote|ul|ol|h[1-6])\b/i.test(tag)) {
      out += "\n";
    }
  }
  return escapeText(decodeEntities(out))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
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
      cls.includes(" font-semibold ") ||
      cls.includes(" font-bold ") ||
      /font-weight: ?(?:bold|[6-9]00)/.test(style),
    italic:
      base.italic || t === "i" || t === "em" || cls.includes(" italic ") || style.includes("italic"),
    strike:
      base.strike ||
      t === "s" ||
      t === "del" ||
      t === "strike" ||
      cls.includes(" line-through ") ||
      style.includes("line-through"),
    code: base.code || t === "code",
  };
}

/** A run of words with its formats, or Markdown that goes out as it is. */
type Run = { text: string; format: Format } | { raw: string };

/** Escape what Markdown would read as formatting (the editor's exporter escapes the same). */
function escapeText(text: string): string {
  return text.replace(/[*_`~\\]/g, "\\$&");
}

function codeSpan(text: string): string {
  let longest = 0;
  let run = 0;
  for (const ch of text) {
    run = ch === "`" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
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
  const body = text.trim();
  if (!body) return text;
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
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
  return /[\s<>]/.test(href) ? `<${href.replace(/[<>]/g, "")}>` : href.replace(/[()\\]/g, "\\$&");
}

/** Source line breaks inside the HTML are whitespace (<br> is the break): one space for each. */
function unwrapLines(text: string): string {
  if (!text.includes("\n")) return text;
  const parts = text.split("\n");
  return parts
    .map((part, i) => {
      let out = part;
      if (i > 0) out = out.trimStart();
      if (i < parts.length - 1) out = out.trimEnd();
      return out;
    })
    .join(" ");
}

/** The inline content of an element as runs. */
function inlineRuns(nodes: Node[], format: Format, out: Run[] = []): Run[] {
  for (const node of nodes) {
    if (typeof node === "string") {
      if (node) out.push({ text: unwrapLines(node), format });
      continue;
    }
    const tag = node.tag;
    if (DROP.has(tag)) continue;
    if (tag === "br") {
      out.push({ raw: "\n" });
      continue;
    }
    if (ENTITY_REF in node.attrs) {
      // A reference: its address only, never its old label (RF-1). One
      // without an address can't resolve, and its text may be a title.
      const type = node.attrs["data-entity-type"] ?? "";
      const id = node.attrs["data-entity-id"] ?? "";
      if (/^[a-z][a-z_-]{0,40}$/.test(type) && /^[A-Za-z0-9-]{1,64}$/.test(id)) {
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
      const label = runsToMarkdown(inlineRuns(node.children, PLAIN)).replace(/[[\]]/g, "\\$&");
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
    .map((line) => line.trimEnd())
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
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999) n = 1;
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

/**
 * The editor's old HTML as Markdown: paragraphs, line breaks, formats, lists,
 * links, references, dates. Only the first CONVERT_LIMIT characters are
 * converted (cut where a tag starts); the rest follows as plain words.
 */
export function htmlToMarkdown(html: string): string {
  let head = html;
  let tail = "";
  if (html.length > CONVERT_LIMIT) {
    // Cut where a tag starts, never inside a reference's stored text (the
    // words that follow drop a reference's text whole).
    const cut = Math.max(0, html.lastIndexOf("<", CONVERT_LIMIT));
    head = html.slice(0, cut);
    tail = htmlWords(html.slice(cut));
  }
  const converted = blocksMarkdown(parseHtml(head).children).join("\n\n");
  return guardMarkdownStart(tail ? `${converted}\n\n${tail}`.trim() : converted);
}

// ── Markdown → words ──────────────────────────────────────────────────────

/** Any Markdown link or image: label, then an address and title that can't hold brackets (nor the address `(` or spaces). */
const ANY_LINK = /!?\[([^[\]\n]*)\]\((?:<[^<>[\]\n]*>|[^()[\]\s]*)(?: "[^"[\]\n]*")?\)/g;

/**
 * A description's words as people read them, from either form: references
 * left out (their label is only a kind, and a reader may not see the item),
 * a date chip as its date, a link as its text, and no Markdown symbols. For
 * search and the Board card's preview. Past CONVERT_LIMIT the text follows as
 * it is.
 */
export function descriptionPlainText(value: string | null | undefined): string {
  const all = descriptionToMarkdown(value);
  if (!all) return "";
  const md = all.length > CONVERT_LIMIT ? all.slice(0, CONVERT_LIMIT) : all;
  const rest = all.length > CONVERT_LIMIT ? all.slice(CONVERT_LIMIT) : "";
  const words = md
    .split("\n")
    .map((line) =>
      line
        // Quotes, list markers and checkboxes at the line's start.
        .replace(/^[ \t]*(?:> ?)+/, "")
        .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]?\][ \t]+)?/, "")
        .replace(/^[ \t]*\[[ xX]?\][ \t]+/, ""),
    )
    .join("\n")
    .replace(new RegExp(DESCRIPTION_LINK.source, "g"), (_m, label: string, type: string, id: string) =>
      type === "date" && ISO_DAY.test(id) ? label : " ",
    )
    .replace(ANY_LINK, "$1")
    .replace(/`/g, "")
    // Emphasis markers (unescaped): ** __ ~~ around words, a single * even
    // inside a word, a single _ only at a word's edge (snake_case stays). Each
    // span stops at the marker's own character, so no match scans past the
    // next marker; leftover ** and ~~ go after.
    .replace(/(^|[^\\])\*\*([^*\n]+)\*\*/g, "$1$2")
    .replace(/(^|[^\\])__([^_\n]+)__/g, "$1$2")
    .replace(/(^|[^\\])~~([^~\n]+)~~/g, "$1$2")
    .replace(/(^|[^\\*])\*([^\s*\\][^*\n]*)\*/g, (m, before: string, inner: string) =>
      /[\s\\]$/.test(inner) ? m : `${before}${inner}`,
    )
    .replace(/(^|[^\w\\])_([^\s_][^_\n]*)_(?!\w)/g, (m, before: string, inner: string) =>
      /[\s\\]$/.test(inner) ? m : `${before}${inner}`,
    )
    .replace(/(^|[^\\])(?:\*\*|~~)/g, "$1")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1");
  return rest ? `${words}${rest}` : words;
}
