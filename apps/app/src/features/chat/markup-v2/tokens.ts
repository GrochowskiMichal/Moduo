// The tokens found inside plain text: bare URLs, `@channel` and `:name:`.
// In the composer they are just text; the parser and the canonical tree both
// split them out of text leaves with this one function, so the two always
// agree on where a token starts and ends.

import type { ChannelLeaf, EmojiLeaf, Inline, Marks, TextLeaf, UrlLeaf } from "./types";

/** A custom emoji name: 2–32 of `a-z 0-9 _ + -` with at least one letter. */
export const EMOJI_NAME_RE = /^(?=[a-z0-9_+-]*[a-z])[a-z0-9_+-]{2,32}$/;

const URL_START = /https?:\/\//gi;
/** Characters a bare URL can't hold: whitespace, angle brackets, a backslash. */
const URL_STOP = /[\s<>\\]/;
/** Punctuation trimmed off a bare URL's end ("see https://x.com/a." → no dot). */
const URL_TRAILING = /[.,:;!?"'*_~]/;

const isAsciiAlnum = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

/** Where the bare URL starting at `start` ends (exclusive), or -1 when there's none. */
function urlEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && !URL_STOP.test(text[end] as string)) end += 1;
  // Trim trailing punctuation, and closing brackets the URL doesn't open (GFM).
  for (;;) {
    const last = text[end - 1] as string;
    if (URL_TRAILING.test(last)) {
      end -= 1;
      continue;
    }
    const pair = last === ")" ? "(" : last === "]" ? "[" : last === "}" ? "{" : null;
    if (pair) {
      const body = text.slice(start, end);
      const opens = body.split(pair).length - 1;
      const closes = body.split(last).length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  const scheme = text.slice(start, end).indexOf("//") + 2;
  return end - start > scheme ? end : -1;
}

type Found = { start: number; end: number; leaf: UrlLeaf | ChannelLeaf | EmojiLeaf };

/** The URLs in `text`: start of text or after a non-alphanumeric. */
function findUrls(text: string, m: Marks): Found[] {
  const out: Found[] = [];
  URL_START.lastIndex = 0;
  for (let hit = URL_START.exec(text); hit; hit = URL_START.exec(text)) {
    if (isAsciiAlnum(text[hit.index - 1])) continue;
    const end = urlEnd(text, hit.index);
    if (end < 0) continue;
    out.push({ start: hit.index, end, leaf: { t: "url", v: text.slice(hit.index, end), m } });
    URL_START.lastIndex = end;
  }
  return out;
}

/** `@channel` at a token start (spine/grammar.ts: line start or after whitespace), as a whole word. */
function findChannels(text: string, from: number, to: number, m: Marks, out: Found[]): void {
  let i = text.indexOf("@channel", from);
  while (i >= 0 && i + 8 <= to) {
    const before = text[i - 1];
    const after = text[i + 8];
    const start = i === 0 || (before !== undefined && /\s/.test(before));
    const whole = after === undefined || !/[A-Za-z0-9_-]/.test(after);
    if (start && whole) out.push({ start: i, end: i + 8, leaf: { t: "channel", m } });
    i = text.indexOf("@channel", i + 1);
  }
}

/** `:name:` not glued to a letter, digit or colon (so "10:30:45" stays text). */
function findEmoji(text: string, from: number, to: number, m: Marks, out: Found[]): void {
  const re = /:([a-z0-9_+-]{2,32}):/g;
  re.lastIndex = from;
  for (let hit = re.exec(text); hit && hit.index + hit[0].length <= to; hit = re.exec(text)) {
    const before = text[hit.index - 1];
    const after = text[hit.index + hit[0].length];
    const name = hit[1] as string;
    if (
      EMOJI_NAME_RE.test(name) &&
      !isAsciiAlnum(before) &&
      before !== ":" &&
      !isAsciiAlnum(after) &&
      after !== ":"
    ) {
      out.push({ start: hit.index, end: hit.index + hit[0].length, leaf: { t: "emoji", name, m } });
    } else {
      // A failed match may still hide one starting at its closing colon.
      re.lastIndex = hit.index + 1;
    }
  }
}

/**
 * Split one text leaf into text, URL, `@channel` and `:name:` leaves. URLs win
 * (a URL may hold "@channel"); the other two are looked for between them.
 */
export function splitTextTokens(
  leaf: TextLeaf,
): Array<TextLeaf | UrlLeaf | ChannelLeaf | EmojiLeaf> {
  const { v: text, m } = leaf;
  if (!/https?:|@channel|:[a-z0-9_+-]{2,32}:/i.test(text)) return [leaf];
  const urls = findUrls(text, m);
  const found: Found[] = [...urls];
  let from = 0;
  for (const gap of [...urls, { start: text.length, end: text.length }]) {
    findChannels(text, from, gap.start, m, found);
    findEmoji(text, from, gap.start, m, found);
    from = gap.end;
  }
  if (found.length === 0) return [leaf];
  found.sort((a, b) => a.start - b.start);
  const out: Array<TextLeaf | UrlLeaf | ChannelLeaf | EmojiLeaf> = [];
  let last = 0;
  for (const f of found) {
    if (f.start < last) continue;
    if (f.start > last) out.push({ t: "text", v: text.slice(last, f.start), m });
    out.push(f.leaf);
    last = f.end;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last), m });
  return out;
}

/** Whether a leaf's last character is whitespace (so `@channel` after it starts a token). */
function endsInSpace(leaf: Inline): boolean {
  if (leaf.t === "text" || leaf.t === "code" || leaf.t === "url") return /\s$/.test(leaf.v);
  return false;
}

/**
 * Split every text leaf into its tokens, then hold `@channel` to the grammar
 * across leaves too: glued to what comes before (`a**@channel**`) it is text,
 * so it never reaches everyone by accident. The parser and the canonical tree
 * both finish with this, so they agree.
 */
export function tokenizeLeaves(leaves: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const leaf of leaves.flatMap((l): Inline[] => (l.t === "text" ? splitTextTokens(l) : [l]))) {
    const prev = out[out.length - 1];
    const item: Inline =
      leaf.t === "channel" && prev && prev.t !== "br" && !endsInSpace(prev)
        ? { t: "text", v: "@channel", m: leaf.m }
        : leaf;
    if (item.t === "text" && prev?.t === "text" && prev.m === item.m) {
      out[out.length - 1] = { ...prev, v: prev.v + item.v };
    } else {
      out.push(item);
    }
  }
  return out;
}

/** The text a token stands for in the composer. */
export function tokenText(leaf: UrlLeaf | ChannelLeaf | EmojiLeaf): string {
  if (leaf.t === "url") return leaf.v;
  if (leaf.t === "channel") return "@channel";
  return `:${leaf.name}:`;
}
