// Chat v2's stored form, as a tree (specs/chat-v2.md Assumptions #3; spike 4,
// docs/build/chat-v2/CV-0-S4.md). A message is stored as a small Markdown
// subset with `moduo://<type>/<id>` references and never a title; the parser
// turns it into this tree, the serializer writes it back, and the Lexical
// bridge maps it to and from the composer. One tree, so the three agree.
//
// Seeded from v1's `Block` / `Inline` (../markup.ts) with two changes:
// - emphasis is a set of marks on each leaf (like Lexical's text formats), not
//   nested nodes, so a run of formats has one shape;
// - line breaks are leaves (`br`), and lists exist (one level).
//
// Pure: no React, no Lexical, no runtime. Values only (rstest imports it).

/** Emphasis bits. They equal Lexical's IS_BOLD / IS_ITALIC / IS_STRIKETHROUGH. */
export const BOLD = 1;
export const ITALIC = 2;
export const STRIKE = 4;
/** Every mark the stored form can hold. */
export const ALL_MARKS = BOLD | ITALIC | STRIKE;
/** A set of marks (`BOLD | ITALIC`). Zero is plain. */
export type Marks = number;

/** Plain or emphasised text. Never empty, never holds "\n". */
export type TextLeaf = { t: "text"; v: string; m: Marks };
/** Inline code (`` `x` ``). Its text is literal: nothing inside is parsed. */
export type CodeLeaf = { t: "code"; v: string; m: Marks };
/** A bare http(s) URL in text, drawn as a link. Text in the composer. */
export type UrlLeaf = { t: "url"; v: string; m: Marks };
/** The `@channel` token: everyone in the conversation. Text in the composer. */
export type ChannelLeaf = { t: "channel"; m: Marks };
/** A `:name:` custom emoji. Drawn as text when the workspace has no such emoji. */
export type EmojiLeaf = { t: "emoji"; name: string; m: Marks };
/** A reference: `moduo://<type>/<uuid>`, person and team mentions included. */
export type RefLeaf = { t: "ref"; type: string; id: string };
/** A date chip: `moduo://date/YYYY-MM-DD`. */
export type DateLeaf = { t: "date"; day: string };
/** `[label](href)`: an explicit link. Its label holds text and code only. */
export type LinkLeaf = { t: "link"; href: string; c: Array<TextLeaf | CodeLeaf> };
/** A line break inside a paragraph, quote or list item. */
export type BrLeaf = { t: "br" };

export type Inline =
  TextLeaf | CodeLeaf | UrlLeaf | ChannelLeaf | EmojiLeaf | RefLeaf | DateLeaf | LinkLeaf | BrLeaf;

export type Block =
  /** Lines of text. Blank lines inside are kept (two `br`s in a row). */
  | { t: "p"; c: Inline[] }
  /** `> ` lines: inline content only. */
  | { t: "quote"; c: Inline[] }
  /** A fenced code block; `lang` is one word or null. */
  | { t: "pre"; v: string; lang: string | null }
  /** `- ` or `1. ` items, one level; each item is inline content. */
  | { t: "list"; ordered: boolean; start: number; items: Inline[][] };

/** Every entity id is a uuid (RF-1's references, profiles, chat rows). */
export const UUID_SOURCE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** A reference's type: the registry's word (`task`, `bucket`, `email_thread`, `person`…). */
export const REF_TYPE_SOURCE = "[a-z][a-z_-]{0,31}";
/** `moduo://type/uuid` or `moduo://date/YYYY-MM-DD`, anchored (sticky use). */
export const URI_RE = new RegExp(
  `moduo://(?:date/(\\d{4}-\\d{2}-\\d{2})|(${REF_TYPE_SOURCE})/(${UUID_SOURCE}))`,
  "y",
);

/** The person mention's URI type (RF-1 has no person node yet; spike 4 settles it). */
export const PERSON_TYPE = "person";
/** A team mention. */
export const TEAM_TYPE = "team";

/** A code block's language word. */
export const LANG_RE = /^[A-Za-z0-9_+#.-]{1,32}$/;

/** True when `day` is a real calendar day written `YYYY-MM-DD`. */
export function isIsoDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The marks a leaf carries (references, dates, links and breaks carry none). */
export function marksOf(leaf: Inline): Marks {
  return "m" in leaf ? leaf.m : 0;
}
