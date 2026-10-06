// Chat message markup — the pure parse/encode layer (specs/chat.md §Messages).
//
// Stored body grammar (what the server keeps):
//   <@USER_ID>                 a person mention (rendered with their CURRENT name)
//   <!channel>                 @channel — everyone in the conversation
//   <moduo:TYPE:ID|Label>      a live reference to a Moduo entity (task, note, …)
//   **bold**  _italic_ / *italic*  ~~strike~~  `code`  ```code block```
//   > quote (line prefix)      bare http(s) URLs autolink
//
// Tokens keep ids, not names, so a rename never rewrites history and a mention
// survives the person changing their display name. The composer types names;
// `encodeComposerText` swaps the picked names for tokens on send.

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "bold"; c: Inline[] }
  | { t: "italic"; c: Inline[] }
  | { t: "strike"; c: Inline[] }
  | { t: "link"; href: string; label: string }
  | { t: "mention"; userId: string }
  | { t: "channel" }
  | { t: "entity"; type: string; id: string; label: string };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "quote"; c: Inline[] }
  | { t: "pre"; v: string; lang: string | null };

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ENTITY_TYPE = "[a-z_]{1,32}";

// One alternation, ordered by priority. Code spans win over everything inside.
const INLINE_RE = new RegExp(
  [
    "(`[^`\\n]+`)", // 1 inline code
    `(<@${UUID}>)`, // 2 mention
    "(<!channel>)", // 3 @channel
    `(<moduo:${ENTITY_TYPE}:${UUID}\\|[^>\\n]{0,200}>)`, // 4 entity ref
    "(https?:\\/\\/[^\\s<>]+[^\\s<>.,;:!?\"')\\]])", // 5 url (no trailing punctuation)
    "(\\*\\*[^\\n]+?\\*\\*)", // 6 bold
    "(~~[^\\n]+?~~)", // 7 strike
    "((?<![\\w*])\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*(?![\\w*]))", // 8 *italic*
    "((?<![\\w_])_(?!\\s)[^_\\n]+?(?<!\\s)_(?![\\w_]))", // 9 _italic_
  ].join("|"),
  "g",
);

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev && prev.t === "text") prev.v += v;
    else out.push({ t: "text", v });
  };
  // A fresh RegExp per call: parseInline recurses for nested emphasis, and a
  // shared global regex would have its lastIndex clobbered by the inner call.
  const re = new RegExp(INLINE_RE.source, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    pushText(src.slice(last, m.index));
    const [whole] = m;
    if (m[1]) out.push({ t: "code", v: whole.slice(1, -1) });
    else if (m[2]) out.push({ t: "mention", userId: whole.slice(2, -1).toLowerCase() });
    else if (m[3]) out.push({ t: "channel" });
    else if (m[4]) {
      const inner = whole.slice("<moduo:".length, -1);
      const bar = inner.indexOf("|");
      const [type, id] = inner.slice(0, bar).split(":");
      out.push({ t: "entity", type, id: id.toLowerCase(), label: inner.slice(bar + 1) });
    } else if (m[5]) out.push({ t: "link", href: whole, label: whole });
    else if (m[6]) out.push({ t: "bold", c: parseInline(whole.slice(2, -2)) });
    else if (m[7]) out.push({ t: "strike", c: parseInline(whole.slice(2, -2)) });
    else if (m[8] || m[9]) out.push({ t: "italic", c: parseInline(whole.slice(1, -1)) });
    last = m.index + whole.length;
  }
  pushText(src.slice(last));
  return out;
}

/** Split a body into blocks: fenced code first, then quote vs paragraph runs. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  const pushProse = (text: string) => {
    const lines = text.replace(/^\n+|\n+$/g, "").split("\n");
    if (lines.length === 1 && lines[0] === "") return;
    let run: string[] = [];
    let runQuote: boolean | null = null;
    const flush = () => {
      if (runQuote === null) return;
      const joined = run.join("\n");
      blocks.push(
        runQuote ? { t: "quote", c: parseInline(joined) } : { t: "p", c: parseInline(joined) },
      );
      run = [];
      runQuote = null;
    };
    for (const line of lines) {
      const isQuote = /^>\s?/.test(line);
      if (runQuote !== null && isQuote !== runQuote) flush();
      runQuote = isQuote;
      run.push(isQuote ? line.replace(/^>\s?/, "") : line);
    }
    flush();
  };
  for (let m = fence.exec(body); m; m = fence.exec(body)) {
    pushProse(body.slice(last, m.index));
    blocks.push({ t: "pre", v: m[2].replace(/\n$/, ""), lang: m[1] || null });
    last = m.index + m[0].length;
  }
  pushProse(body.slice(last));
  return blocks;
}

/** Plain-text rendering (notification excerpts, search snippets, previews). */
export function toPlainText(body: string, nameOf: (userId: string) => string): string {
  const flat = (nodes: Inline[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case "text":
          case "code":
            return n.v;
          case "bold":
          case "italic":
          case "strike":
            return flat(n.c);
          case "link":
            return n.label;
          case "mention":
            return `@${nameOf(n.userId)}`;
          case "channel":
            return "@channel";
          case "entity":
            return n.label;
          default:
            return "";
        }
      })
      .join("");
  return parseBody(body)
    .map((b) => (b.t === "pre" ? b.v : flat(b.c)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every user id mentioned in a body (deduped, in order). */
export function mentionedUserIds(body: string): string[] {
  const ids: string[] = [];
  for (const m of body.matchAll(new RegExp(`<@(${UUID})>`, "g"))) {
    const id = m[1].toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function hasChannelMention(body: string): boolean {
  return body.includes("<!channel>");
}

// Up to three emoji and nothing else → render large ("jumbomoji").
const EMOJI_ONLY =
  /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u;
export function isEmojiOnly(body: string): boolean {
  const t = body.trim();
  return t.length > 0 && EMOJI_ONLY.test(t);
}

// ── Composer encoding ────────────────────────────────────────────────────────

/** Something the user picked from an autocomplete while typing. */
export type ComposerPick =
  | { kind: "person"; userId: string; label: string }
  | { kind: "entity"; type: string; id: string; label: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cleanLabel = (s: string) =>
  s
    .replace(/[|>\n]/g, " ")
    .trim()
    .slice(0, 200);

/**
 * Turn what the user typed into the stored body. Picks are matched by their
 * visible text (`@Ana Kowalska`, `#Launch plan`) — longest first so "@Ana K"
 * never eats "@Ana Kowalska". `@channel` / `@here` become `<!channel>`.
 */
export function encodeComposerText(
  text: string,
  picks: ComposerPick[],
): { body: string; mentionedUserIds: string[]; notifyChannel: boolean } {
  let body = text;
  const sorted = [...picks].sort((a, b) => b.label.length - a.label.length);
  for (const pick of sorted) {
    if (pick.kind === "person") {
      const re = new RegExp(`(^|[^\\w@])@${escapeRe(pick.label)}(?![\\w])`, "g");
      body = body.replace(re, (_m, pre: string) => `${pre}<@${pick.userId}>`);
    } else {
      const re = new RegExp(`(^|[^\\w#])#${escapeRe(pick.label)}(?![\\w])`, "g");
      body = body.replace(
        re,
        (_m, pre: string) => `${pre}<moduo:${pick.type}:${pick.id}|${cleanLabel(pick.label)}>`,
      );
    }
  }
  body = body.replace(
    /(^|[^\w@])@(channel|here|everyone)\b/g,
    (_m, pre: string) => `${pre}<!channel>`,
  );
  return {
    body,
    mentionedUserIds: mentionedUserIds(body),
    notifyChannel: hasChannelMention(body),
  };
}

/** The inverse, for editing: tokens back to typed text + the picks that make them. */
export function decodeForComposer(
  body: string,
  nameOf: (userId: string) => string,
): { text: string; picks: ComposerPick[] } {
  const picks: ComposerPick[] = [];
  let text = body.replace(new RegExp(`<@(${UUID})>`, "g"), (_m, id: string) => {
    const userId = id.toLowerCase();
    const label = nameOf(userId);
    if (!picks.some((p) => p.kind === "person" && p.userId === userId))
      picks.push({ kind: "person", userId, label });
    return `@${label}`;
  });
  text = text.replace(
    new RegExp(`<moduo:(${ENTITY_TYPE}):(${UUID})\\|([^>\\n]{0,200})>`, "g"),
    (_m, type: string, id: string, label: string) => {
      picks.push({ kind: "entity", type, id: id.toLowerCase(), label });
      return `#${label}`;
    },
  );
  text = text.replace(/<!channel>/g, "@channel");
  return { text, picks };
}

/** The `@query` / `#query` being typed at the caret, if any. */
export function activeTrigger(
  text: string,
  caret: number,
): { trigger: "@" | "#" | ":"; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])([@#:])([^\s@#:]{0,40})$/.exec(before);
  if (!m) return null;
  const trigger = m[2] as "@" | "#" | ":";
  // `:` only opens the emoji picker after two letters (so "time: 10" stays quiet).
  if (trigger === ":" && m[3].length < 2) return null;
  return { trigger, query: m[3], start: before.length - m[3].length - 1 };
}
