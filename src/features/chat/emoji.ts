// A curated emoji set for reactions + the `:shortcode` composer picker. Small
// on purpose — the long tail lives in the OS emoji keyboard (⌃⌘Space), which
// works in the composer too. Names are the searchable shortcodes.

export type EmojiEntry = { e: string; n: string[] };
export type EmojiGroup = { id: string; label: string; items: EmojiEntry[] };

const g = (id: string, label: string, rows: [string, string][]): EmojiGroup => ({
  id,
  label,
  items: rows.map(([e, names]) => ({ e, n: names.split(" ") })),
});

export const EMOJI_GROUPS: EmojiGroup[] = [
  g("smileys", "Smileys", [
    ["😀", "grinning smile happy"],
    ["😄", "smile happy joy"],
    ["😁", "grin beaming"],
    ["😂", "joy laugh tears lol"],
    ["🤣", "rofl rolling laugh"],
    ["😊", "blush smiling"],
    ["🙂", "slight_smile"],
    ["😉", "wink"],
    ["😍", "heart_eyes love"],
    ["🥰", "smiling_hearts love"],
    ["😘", "kiss"],
    ["😎", "sunglasses cool"],
    ["🤓", "nerd"],
    ["🤔", "thinking hmm"],
    ["🤨", "raised_eyebrow skeptical"],
    ["😐", "neutral"],
    ["😑", "expressionless"],
    ["🙄", "eye_roll"],
    ["😏", "smirk"],
    ["😬", "grimace yikes"],
    ["😮", "open_mouth wow"],
    ["😯", "hushed"],
    ["😲", "astonished shocked"],
    ["🥲", "smiling_tear"],
    ["😢", "cry sad"],
    ["😭", "sob"],
    ["😤", "triumph huff"],
    ["😡", "rage angry"],
    ["🤯", "exploding_head mind_blown"],
    ["😳", "flushed"],
    ["🥳", "partying party"],
    ["😴", "sleeping zzz"],
    ["🤗", "hug hugging"],
    ["🤫", "shush quiet"],
    ["🫡", "salute"],
    ["🫠", "melting"],
    ["🙃", "upside_down"],
    ["😅", "sweat_smile phew"],
    ["😇", "innocent halo"],
    ["🤝", "handshake deal"],
  ]),
  g("hands", "Gestures", [
    ["👍", "+1 thumbsup yes like"],
    ["👎", "-1 thumbsdown no"],
    ["👏", "clap applause"],
    ["🙌", "raised_hands hooray"],
    ["🙏", "pray thanks please"],
    ["👋", "wave hello hi bye"],
    ["✌️", "v peace"],
    ["🤞", "crossed_fingers luck"],
    ["👌", "ok_hand perfect"],
    ["🤌", "pinched"],
    ["👀", "eyes looking"],
    ["💪", "muscle strong"],
    ["🫶", "heart_hands"],
    ["☝️", "point_up"],
    ["👉", "point_right"],
    ["👈", "point_left"],
    ["✋", "hand stop"],
    ["🤙", "call_me"],
    ["🖖", "vulcan"],
    ["✍️", "writing"],
  ]),
  g("symbols", "Symbols", [
    ["✅", "white_check_mark done check"],
    ["☑️", "ballot_box_with_check"],
    ["✔️", "heavy_check_mark"],
    ["❌", "x cross no"],
    ["⚠️", "warning"],
    ["❗", "exclamation important"],
    ["❓", "question"],
    ["💯", "100 hundred"],
    ["❤️", "heart love red_heart"],
    ["🧡", "orange_heart"],
    ["💛", "yellow_heart"],
    ["💚", "green_heart"],
    ["💙", "blue_heart"],
    ["💜", "purple_heart"],
    ["🖤", "black_heart"],
    ["💔", "broken_heart"],
    ["🔥", "fire lit hot"],
    ["✨", "sparkles"],
    ["⭐", "star"],
    ["🌟", "glowing_star"],
    ["💡", "bulb idea"],
    ["🎯", "dart target"],
    ["🚀", "rocket ship launch"],
    ["🎉", "tada party celebrate"],
    ["🎊", "confetti"],
    ["🏆", "trophy win"],
    ["🥇", "first_place gold"],
    ["📌", "pushpin pin"],
    ["📎", "paperclip"],
    ["🔗", "link"],
    ["🔒", "lock"],
    ["🔑", "key"],
    ["⏳", "hourglass waiting"],
    ["⏰", "alarm_clock"],
    ["📅", "date calendar"],
    ["📝", "memo note"],
    ["📣", "mega announcement"],
    ["🔔", "bell"],
    ["🔕", "no_bell mute"],
    ["💬", "speech_balloon comment"],
    ["🧠", "brain"],
    ["🐛", "bug"],
    ["🛠️", "tools hammer_and_wrench"],
    ["⚙️", "gear settings"],
    ["📈", "chart_up trending"],
    ["📉", "chart_down"],
    ["💰", "moneybag money"],
    ["☕", "coffee"],
    ["🍕", "pizza"],
    ["🍻", "beers cheers"],
  ]),
  g("nature", "Nature", [
    ["🌱", "seedling grow"],
    ["🌿", "herb"],
    ["🌳", "tree"],
    ["🌸", "cherry_blossom"],
    ["🌻", "sunflower"],
    ["☀️", "sunny sun"],
    ["🌙", "moon"],
    ["🌈", "rainbow"],
    ["⚡", "zap lightning"],
    ["❄️", "snowflake"],
    ["🌊", "wave ocean"],
    ["🐶", "dog"],
    ["🐱", "cat"],
    ["🦊", "fox"],
    ["🐼", "panda"],
    ["🦄", "unicorn"],
    ["🐢", "turtle slow"],
    ["🦉", "owl"],
    ["🐝", "bee"],
    ["🦋", "butterfly"],
  ]),
];

/** Quick reactions shown on hover (the Slack/Discord top three, plus two). */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"];

const ALL: EmojiEntry[] = EMOJI_GROUPS.flatMap((grp) => grp.items);

/** Primary-name prefix first, then any alias prefix, then substring — `:ta` → 🎉 before 🎯. */
export function searchEmoji(query: string, limit = 24): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/^:/, "");
  if (!q) return ALL.slice(0, limit);
  const primary: EmojiEntry[] = [];
  const alias: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const entry of ALL) {
    if (entry.n[0]?.startsWith(q)) primary.push(entry);
    else if (entry.n.some((n) => n.startsWith(q))) alias.push(entry);
    else if (entry.n.some((n) => n.includes(q))) contains.push(entry);
  }
  return [...primary, ...alias, ...contains].slice(0, limit);
}

const RECENT_KEY = "moduo:chat:recent-emoji";

export function readRecentEmoji(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, 16)
      : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  try {
    const next = [emoji, ...readRecentEmoji().filter((e) => e !== emoji)].slice(0, 16);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage disabled */
  }
}
