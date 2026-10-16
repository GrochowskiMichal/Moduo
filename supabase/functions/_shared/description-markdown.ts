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
  // Own keys only: "constructor" is a type a crafted description can name.
  return Object.hasOwn(WORDS, type) ? WORDS[type] : "item";
}

/** A reference as the description stores it. A chip (the default) has no title. */
export function referenceMarkdown(type: string, id: string, display?: string | null): string {
  const shown = display && display !== "chip" && DISPLAYS.includes(display as DescriptionDisplay);
  return `[${referenceWord(type)}](moduo://${type}/${id}${shown ? ` "${display}"` : ""})`;
}

/** A piece of a description's Markdown: words, or a link DESCRIPTION_LINK reads (a reference or a date chip). */
export type DescriptionToken =
  | { kind: "text"; text: string }
  | {
      kind: "link";
      label: string;
      type: string;
      id: string;
      display: string | undefined;
      /** The link as written. */
      raw: string;
      /** Inside a fenced block or an inline code span, where the editor shows it as code. */
      inCode: boolean;
    };

/** The editor's fences: backticks only (Lexical's CODE). */
const FENCE_LINE = /^[ \t]*(`{3,})/;

/** Is the character at `at` escaped (an odd run of backslashes before it)? */
function escapedAt(line: string, at: number): boolean {
  let n = 0;
  for (let i = at - 1; i >= 0 && line[i] === "\\"; i--) n++;
  return n % 2 === 1;
}

/**
 * Where a description's code is, as [start, end) offsets in order: fenced
 * blocks (to their closing fence, or the end) and inline code spans (a run of
 * backticks that isn't escaped, to the next run as long, on one line). One
 * pass: each length's runs are looked through once. It only decides what is
 * linked: a reference is checked and written the same in code or out of it.
 */
export function codeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let fence: { length: number; start: number } | null = null;
  for (const line of markdown.split("\n")) {
    const lineEnd = offset + line.length;
    const open = FENCE_LINE.exec(line);
    if (fence) {
      if (open && (open[1]?.length ?? 0) >= fence.length && line.trim() === open[1]) {
        ranges.push([fence.start, lineEnd]);
        fence = null;
      }
    } else if (open) {
      fence = { length: open[1]?.length ?? 3, start: offset };
    } else if (line.includes("`")) {
      // [position, length, escaped]
      const runs: Array<[number, number, boolean]> = [];
      for (let i = 0; i < line.length; ) {
        if (line[i] !== "`") {
          i++;
          continue;
        }
        let j = i;
        while (line[j] === "`") j++;
        runs.push([i, j - i, escapedAt(line, i)]);
        i = j;
      }
      const byLength = new Map<number, number[]>();
      runs.forEach(([, length], k) => {
        const list = byLength.get(length);
        if (list) list.push(k);
        else byLength.set(length, [k]);
      });
      const next = new Map<number, number>();
      for (let k = 0; k < runs.length; ) {
        const [pos, length, escaped] = runs[k] as [number, number, boolean];
        // An escaped backtick is a literal one: it opens nothing.
        if (escaped) {
          k++;
          continue;
        }
        const list = byLength.get(length) as number[];
        let p = next.get(length) ?? 0;
        while (p < list.length && (list[p] as number) <= k) p++;
        next.set(length, p);
        if (p >= list.length) {
          k++;
          continue;
        }
        const close = list[p] as number;
        ranges.push([offset + pos, offset + (runs[close] as [number, number, boolean])[0] + length]);
        k = close + 1;
      }
    }
    offset = lineEnd + 1;
  }
  if (fence) ranges.push([fence.start, markdown.length]);
  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * A description's Markdown cut into words and the `moduo://` links in it, in
 * order: the one reading of references every reader shares (the editor's
 * import matches the same pattern, leftmost first). Whatever writes a
 * description on someone's behalf checks these links, writes back only the
 * ones that passed as links, and passes every other word through
 * `defuseReferences`. A link inside code (`inCode`) is shown as code, so it
 * links nothing.
 */
export function descriptionTokens(markdown: string): DescriptionToken[] {
  const out: DescriptionToken[] = [];
  const code = codeRanges(markdown);
  let range = 0;
  let at = 0;
  for (const m of markdown.matchAll(new RegExp(DESCRIPTION_LINK.source, "g"))) {
    const start = m.index ?? 0;
    while (range < code.length && (code[range] as [number, number])[1] <= start) range++;
    const inCode = range < code.length && (code[range] as [number, number])[0] <= start;
    if (start > at) out.push({ kind: "text", text: markdown.slice(at, start) });
    out.push({
      kind: "link",
      label: m[1] ?? "",
      type: m[2] ?? "",
      id: m[3] ?? "",
      display: m[4],
      raw: m[0],
      inCode,
    });
    at = start + m[0].length;
  }
  if (at < markdown.length) out.push({ kind: "text", text: markdown.slice(at) });
  return out;
}

/** The items a description references, each once, in order (date chips aren't items). */
export function descriptionReferences(value: string | null | undefined): Array<{ type: string; id: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; id: string }> = [];
  for (const token of descriptionTokens(descriptionToMarkdown(value))) {
    if (token.kind !== "link" || token.inCode) continue;
    const { type, id } = token;
    if (!type || !id || type === "date" || seen.has(`${type}:${id}`)) continue;
    seen.add(`${type}:${id}`);
    out.push({ type, id });
  }
  return out;
}

/** How far into an address its scheme is read (spellings included). */
const ADDRESS_LOOK = 128;
const SKIPPED = /[\s<\\]/;

/** A code point from a character reference, or nothing when it names none. */
function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/**
 * Does a link address read as the app's `moduo:` scheme, however it's
 * spelled? The editor's link reader decodes an address before it keeps it
 * (backslash escapes, `&#58;`-style character references, a `<…>` form,
 * spaces before it), so this decodes the same and more: every backslash,
 * space and `<` dropped, decimal, hex and the named references that can
 * spell it (`&colon;`, `&amp;`) decoded, again and again while that changes
 * anything (double-encoded `&#38;#58;` too), any case.
 */
export function readsAsModuoAddress(address: string): boolean {
  let plain = address.slice(0, ADDRESS_LOOK);
  for (let round = 0; round < 4; round++) {
    const decoded = plain
      .replace(/&#[xX]([0-9a-fA-F]+);?/g, (_, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);?/g, (_, dec: string) => fromCodePoint(Number(dec)))
      .replace(/&colon;?/gi, ":")
      .replace(/&amp;?/gi, "&")
      .replace(/[\\\s<]/g, "");
    if (decoded === plain) break;
    plain = decoded;
  }
  return plain.replace(/[\\\s<]/g, "").slice(0, 6).toLowerCase() === "moduo:";
}

/**
 * Words that would read as a `moduo:` link, now or once read back (a `](`
 * whose address reads as `moduo:`, `readsAsModuoAddress`), keep that `(` as
 * `&#40;`: Markdown's own spelling of "(", which the editor reads back as "("
 * in plain words, while no reference or link pattern matches it. So words
 * never turn into a reference: not when they are stored, and not when the
 * editor saves them again. One look per `](`, each at most ADDRESS_LOOK long.
 */
export function defuseReferences(text: string): string {
  let out = "";
  let at = 0;
  for (let i = text.indexOf("]("); i >= 0; i = text.indexOf("](", i + 2)) {
    // Spaces, `<` and backslashes before the address, however many (each run
    // follows one `](` only, so this stays one pass).
    let start = i + 2;
    while (start < text.length && SKIPPED.test(text[start] as string)) start++;
    if (!readsAsModuoAddress(text.slice(start, start + ADDRESS_LOOK))) continue;
    out += `${text.slice(at, i)}]&#40;`;
    at = i + 2;
  }
  return out + text.slice(at);
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

// ── Escaping words as Markdown ────────────────────────────────────────────

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const BLANK = /\s/;

/**
 * Words as Markdown text, escaped only where Markdown would read them as
 * something else (call #15), so stored text stays searchable as written:
 * - `_` inside a word (`file_name`) can't start emphasis and stays bare;
 * - `*` with a space on both sides (`5 * 3`) can't either;
 * - a single `~` can't strike through (it takes two);
 * - a backtick stays bare when it's the only one in its block (`lonelyBacktick`);
 * - `\` is escaped only before punctuation, where it would escape it;
 * - `&` that starts a character reference (`&#40;`) is written `&#38;`.
 * The text's own edges count as "could be anything", so a character there is
 * escaped: the words around it may sit in another run.
 */
export function escapeMarkdownText(text: string, opts: { lonelyBacktick?: boolean } = {}): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const prev = text[i - 1];
    const next = text[i + 1];
    switch (ch) {
      case "\\":
        out += next === undefined || ASCII_PUNCTUATION.test(next) ? "\\\\" : "\\";
        break;
      case "_":
        out += prev !== undefined && next !== undefined && WORD_CHAR.test(prev) && WORD_CHAR.test(next) ? "_" : "\\_";
        break;
      case "*":
        out += prev !== undefined && next !== undefined && BLANK.test(prev) && BLANK.test(next) ? "*" : "\\*";
        break;
      case "~":
        out += prev === undefined || next === undefined || prev === "~" || next === "~" ? "\\~" : "~";
        break;
      case "`":
        out += opts.lonelyBacktick ? "`" : "\\`";
        break;
      case "&": {
        // `&#40;` typed as words stays those words: a reader would decode it.
        let j = i + 1;
        if (text[j] === "#") {
          j++;
          while (j < text.length && /\d/.test(text[j] as string)) j++;
        }
        out += j > i + 2 && text[j] === ";" ? "&#38;" : "&";
        break;
      }
      default:
        out += ch;
    }
  }
  return out;
}

/**
 * A paragraph's line whose words start like a block (`- `, `+ `, `1. `, `> `,
 * `[ ] `) keeps that start escaped, as `*` is, so the next read gives the
 * paragraph back, not a list, a quote or a checkbox ("2026. Q4 plan" stays
 * words). Each line counts: a line break inside the paragraph starts a line.
 * The patterns are the editor's own (any space, a non-breaking one too, and
 * any number of digits), so nothing it reads as a block start slips through.
 */
export function escapeBlockStarts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)([-*+])(?=\s)/, "$1\\$2")
        .replace(/^(\s*)(\d+)\.(?=\s)/, "$1$2\\.")
        .replace(/^(\s*)>/, "$1\\>")
        .replace(/^(\s*)\[(\s|[xX])?\](?=\s)/, "$1\\[$2]"),
    )
    .join("\n");
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
    const name = code.toLowerCase();
    return Object.hasOwn(NAMED, name) ? NAMED[name] : m;
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
 * The words of HTML past CONVERT_LIMIT, in one pass: tags dropped, entities
 * decoded, escaped as Markdown text, one line per block; a reference as its
 * Markdown link (its stored text, which may be a title, dropped, RF-1).
 */
function htmlWords(html: string): string {
  let out = "";
  let words = "";
  const flushWords = () => {
    out += escapeText(decodeEntities(words));
    words = "";
  };
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      words += html.slice(i);
      break;
    }
    words += html.slice(i, lt);
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break;
    const tag = html.slice(lt, gt + 1);
    i = gt + 1;
    if (tag.includes(ENTITY_REF)) {
      const name = /^<([a-zA-Z][a-zA-Z0-9-]{0,30})/.exec(tag);
      const attrs = parseAttrs(tag.slice(1 + (name?.[1].length ?? 0), -1));
      const type = attrs["data-entity-type"] ?? "";
      const id = attrs["data-entity-id"] ?? "";
      flushWords();
      if (/^[a-z][a-z_-]{0,40}$/.test(type) && /^[A-Za-z0-9-]{1,64}$/.test(id)) {
        out += referenceMarkdown(type, id, attrs["data-display"]);
      }
      const close = html.indexOf("</span", i);
      i = close < 0 ? n : close;
    } else if (/^<\/?(?:p|div|li|br|blockquote|ul|ol|h[1-6])\b/i.test(tag)) {
      words += "\n";
    }
  }
  flushWords();
  return out
    .split("\n")
    .map((line) => escapeBlockStarts(line.trim()))
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

/** Escape what Markdown would read as formatting (the editor's text export uses the same rules). */
function escapeText(text: string): string {
  return escapeMarkdownText(text);
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

/** A `<pre>`'s text as written: its line breaks kept, a `<br>` as one. */
function preText(node: Node): string {
  if (typeof node === "string") return node;
  return node.tag === "br" ? "\n" : node.children.map(preText).join("");
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
    // A link to a `moduo:` address, however spelled, is its words: references
    // come only from the editor's reference spans (and are checked on writes).
    if (tag === "a" && node.attrs.href && !readsAsModuoAddress(node.attrs.href)) {
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
    // An item's words that start like a block stay words, not a nested list.
    const text = escapeBlockStarts(inlineMarkdown(inline));
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
  // A paragraph whose words start like a block ("2026. Q4 plan", "- not a
  // list") stays a paragraph: the old editor had no lists, so it never was one.
  const paragraph = (text: string) => {
    if (text) blocks.push(escapeBlockStarts(text));
  };
  const flushInline = () => {
    paragraph(inlineMarkdown(inline));
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
      // One quote: its paragraphs are its lines (a bare ">" line would read
      // back as the words ">", and nest on the next save).
      // A blank line inside it (a code block's) stays, as "> ", which reads
      // back as the quote's own empty line.
      const lines = blocksMarkdown(node.children).join("\n").split("\n");
      let first = 0;
      let last = lines.length - 1;
      while (first <= last && (lines[first] as string).trim() === "") first++;
      while (last >= first && (lines[last] as string).trim() === "") last--;
      if (first <= last) {
        blocks.push(
          lines
            .slice(first, last + 1)
            .map((line) => `> ${line}`)
            .join("\n"),
        );
      }
    } else if (node.tag === "pre") {
      // Code as written, in a fence longer than any run of backticks in it.
      const code = preText(node).replace(/\n$/, "");
      if (code.trim()) {
        let longest = 0;
        for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
        const fence = "`".repeat(Math.max(3, longest + 1));
        blocks.push(`${fence}\n${code}\n${fence}`);
      }
    } else if (node.tag === "li") {
      const text = escapeBlockStarts(inlineMarkdown(node.children));
      if (text) blocks.push(`- ${text}`);
    } else {
      // p, div, h1–h6: a paragraph (a div holding blocks is read through).
      if (node.children.some(isBlock)) blocks.push(...blocksMarkdown(node.children));
      else paragraph(inlineMarkdown(node.children));
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
