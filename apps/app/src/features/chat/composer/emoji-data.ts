// Emoji for the composer (#18): Emojibase's data, bundled with the app (never
// fetched from a CDN) and loaded on first use, in its own chunk. The picker
// (Frimousse) reads it through `resolveChatEmoji`; the `:` menu searches the
// same list by name and GitHub/Slack shortcode. Native emoji only: the font is
// the system's. The workspace's custom emoji are CV-20's.

import type { EmojiData, EmojiDataResolver } from "frimousse";

/** Emoji newer than this aren't offered (older systems draw them as boxes). */
export const MAX_EMOJI_VERSION = 15;

type Skin = { emoji: string; tone?: number | number[] };
type RawEmoji = {
  emoji: string;
  label: string;
  group?: number;
  subgroup?: number;
  version: number;
  tags?: string[];
  skins?: Skin[];
};
type RawMessages = {
  groups: Array<{ key: string; message: string; order: number }>;
  subgroups: Array<{ key: string; message: string; order: number }>;
  skinTones: Array<{ key: string; message: string }>;
};

export type ChatEmoji = {
  emoji: string;
  label: string;
  /** Shortcodes without colons (`thumbsup`, `+1`). */
  codes: string[];
  tags: string[];
};

const TONES = ["light", "medium-light", "medium", "medium-dark", "dark"] as const;

const firstUpper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

let loading: Promise<{ picker: EmojiData; list: ChatEmoji[] }> | null = null;

/** Build the picker's data and the `:` list from Emojibase's files. */
export function buildEmojiData(
  raw: readonly RawEmoji[],
  messages: RawMessages,
  shortcodes: Record<string, string | string[]>,
  hexcodeOf: (e: RawEmoji) => string,
): { picker: EmojiData; list: ChatEmoji[] } {
  const flags = messages.subgroups.find((s) => s.key === "country-flag");
  const groups = messages.groups.filter((g) => g.key !== "component");
  const emojis: EmojiData["emojis"] = [];
  const list: ChatEmoji[] = [];
  for (const e of raw) {
    if (e.group === undefined || e.version > MAX_EMOJI_VERSION) continue;
    if (!groups.some((g) => g.order === e.group)) continue;
    const skins: Record<string, string> = {};
    for (const s of e.skins ?? []) {
      if (typeof s.tone === "number") {
        const name = TONES[s.tone - 1];
        if (name) skins[name] = s.emoji;
      }
    }
    emojis.push({
      emoji: e.emoji,
      category: e.group,
      label: firstUpper(e.label),
      version: e.version,
      tags: e.tags ?? [],
      ...(flags && e.subgroup === flags.order ? { countryFlag: true as const } : {}),
      ...(Object.keys(skins).length === 5
        ? { skins: skins as Record<(typeof TONES)[number], string> }
        : {}),
    });
    const codes = shortcodes[hexcodeOf(e)];
    list.push({
      emoji: e.emoji,
      label: e.label,
      codes: codes ? (Array.isArray(codes) ? codes : [codes]) : [],
      tags: e.tags ?? [],
    });
  }
  const skinTones = Object.fromEntries(
    messages.skinTones.map((t) => [t.key, firstUpper(t.message)]),
  ) as EmojiData["skinTones"];
  return {
    picker: {
      locale: "en",
      emojis,
      categories: groups.map((g) => ({ index: g.order, label: firstUpper(g.message) })),
      skinTones,
    },
    list,
  };
}

/** Load (once) and build the emoji data. */
export function loadChatEmoji(): Promise<{ picker: EmojiData; list: ChatEmoji[] }> {
  loading ??= Promise.all([
    import("emojibase-data/en/data.json"),
    import("emojibase-data/en/messages.json"),
    import("emojibase-data/en/shortcodes/github.json"),
  ])
    .then(([data, messages, codes]) =>
      buildEmojiData(
        (data.default ?? data) as unknown as RawEmoji[],
        (messages.default ?? messages) as unknown as RawMessages,
        (codes.default ?? codes) as unknown as Record<string, string | string[]>,
        (e) => (e as RawEmoji & { hexcode: string }).hexcode,
      ),
    )
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

/** Frimousse's data, from the bundle (`resolveEmojiData`). */
export const resolveChatEmoji: EmojiDataResolver = () =>
  loadChatEmoji().then((data) => data.picker);

/**
 * The `:` menu's matches: a shortcode that starts with the query first, then a
 * name word that does, then a tag. Up to `limit`.
 */
export function matchEmoji(list: readonly ChatEmoji[], query: string, limit = 8): ChatEmoji[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const ranked: Array<{ e: ChatEmoji; score: number }> = [];
  for (const e of list) {
    let score = -1;
    if (e.codes.some((c) => c === q)) score = 0;
    else if (e.codes.some((c) => c.startsWith(q))) score = 1;
    else if (
      e.label
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q))
    )
      score = 2;
    else if (e.tags.some((t) => t.startsWith(q))) score = 3;
    if (score >= 0) ranked.push({ e, score });
  }
  ranked.sort((a, b) => a.score - b.score);
  return ranked.slice(0, limit).map((r) => r.e);
}
