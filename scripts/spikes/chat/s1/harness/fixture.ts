// CV-0 spike 1: the 10,000-message fixture, in memory and deterministic
// (seeded), with the mix the stream must carry: one-liners, paragraphs, long
// multi-paragraph messages, code blocks, image rows with stored sizes, reply
// chains (replies live in the stream, right after their root) and ~300 days.

export type MsgKind = "short" | "medium" | "long" | "code" | "image";

export type Msg = {
  id: string;
  /** Position in the conversation (0 = oldest). */
  seq: number;
  author: number;
  /** ms since epoch */
  at: number;
  kind: MsgKind;
  text: string;
  /** Stored size of the image (the box is reserved from it). */
  img?: { w: number; h: number };
  /** For a reply: its chain's root id. */
  root?: string;
  /** For a root: how many replies follow it. */
  replies?: number;
};

export const AUTHORS = [
  "Maciej Grzywacz",
  "Mike Grochowski",
  "Ola Nowak",
  "Kasia Wiśniewska",
  "Tomek Zieliński",
  "Ana Lima",
  "Jun Sato",
  "Piotr Wójcik",
];

const WORDS =
  "zadanie projekt termin spotkanie notatka żółw źdźbło łódź gęś przegląd wdrożenie poprawka release build deploy review design token stream message chain reply today tomorrow later sync store cache measure anchor scroll density compact image link figma prototype sprint kanban calendar booking email contact invoice workspace channel thread mention reaction emoji pinned decision reminder export search filter ticket bug fix test perf budget frame window prepend append fold edit draft cześć dzięki jasne okej super zrobione sprawdzę jutro później widzę mamy działa nie tak może trochę bardzo szybko wolno teraz dalej the a to of and is it for on with that this we you be at by from as or are but not have can will just".split(
    " ",
  );

const CODE_LINES = [
  "const rows = useMemo(() => buildRows(messages), [messages]);",
  "select id, created_at from chat_messages where channel_id = $1",
  "  order by created_at desc, id desc limit 50;",
  "if (virtualizer.isAtEnd()) virtualizer.scrollToEnd();",
  "export function anchor(key: string) {",
  "  return el.getBoundingClientRect().top;",
  "}",
  "bun run verify && bun run perf",
  "git switch -c t/maciej/cv-7a-stream origin/t/maciej/chat-v2-build",
  "await page.evaluate(() => window.__s1.run());",
  "    for (const row of rows) measure(row);",
  "// TODO: keep the anchor row under the pointer",
  'fetch("/rest/v1/chat_messages?select=*")',
  "  .then((r) => r.json())",
];

const IMAGE_SIZES: Array<[number, number]> = [
  [1600, 1200],
  [1200, 1600],
  [1920, 1080],
  [800, 800],
  [3000, 1000],
  [1080, 1920],
  [640, 480],
];

/** mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sentence(r: () => number, min: number, max: number): string {
  const n = min + Math.floor(r() * (max - min + 1));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(r() * WORDS.length)] as string);
  const s = out.join(" ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export const COUNT = 10_000;
/** The fixture's "now" (the newest message is a little before it). */
export const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);

/** Chains placed where the scenarios need them (index of the root → replies). */
export const SCENARIO_CHAINS = {
  /** Mid-history fold (inside the window the prepend scenario builds). */
  mid: 9_600,
  /** A chain inside the newest 50 (fold at the end). */
  end: 9_975,
  /** Near row 5,000 (the jump target's neighbourhood). */
  deep: 5_010,
} as const;

function build(): Msg[] {
  const r = rng(20261014);
  const msgs: Msg[] = [];
  // Times: bursts (30 s – 5 min apart) and quiet gaps (hours), rescaled so the
  // newest message lands a few minutes before NOW.
  const gaps: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    gaps.push(r() < 0.72 ? 30_000 + r() * 270_000 : -Math.log(1 - r()) * 8 * 3_600_000);
  }
  const span = 318 * 86_400_000;
  const sum = gaps.reduce((a, b) => a + b, 0);
  let t = NOW - 5 * 60_000 - span;
  let prevAuthor = 0;
  for (let i = 0; i < COUNT; i++) {
    t += ((gaps[i] as number) / sum) * span;
    const author = r() < 0.55 ? prevAuthor : Math.floor(r() * AUTHORS.length);
    prevAuthor = author;
    const k = r();
    let kind: MsgKind;
    let text: string;
    let img: Msg["img"];
    if (k < 0.5) {
      kind = "short";
      text = sentence(r, 2, 12);
    } else if (k < 0.72) {
      kind = "medium";
      text = `${sentence(r, 10, 22)} ${sentence(r, 8, 20)}`;
    } else if (k < 0.8) {
      kind = "long";
      const paras = 2 + Math.floor(r() * 3);
      const out: string[] = [];
      for (let p = 0; p < paras; p++) out.push(`${sentence(r, 25, 45)} ${sentence(r, 15, 35)}`);
      text = out.join("\n\n");
    } else if (k < 0.87) {
      kind = "code";
      const lines = 3 + Math.floor(r() * 11);
      const start = Math.floor(r() * CODE_LINES.length);
      const out: string[] = [];
      for (let l = 0; l < lines; l++)
        out.push(CODE_LINES[(start + l) % CODE_LINES.length] as string);
      text = out.join("\n");
    } else if (k < 0.92) {
      kind = "image";
      const [w, h] = IMAGE_SIZES[Math.floor(r() * IMAGE_SIZES.length)] as [number, number];
      img = { w, h };
      text = r() < 0.5 ? sentence(r, 2, 8) : "";
    } else {
      kind = "short";
      text = `${sentence(r, 1, 6)} 🙂 https://moduo.app/docs/${Math.floor(r() * 1000)}`;
    }
    msgs.push({
      id: `m${String(i).padStart(5, "0")}`,
      seq: i,
      author,
      at: Math.round(t),
      kind,
      text,
      ...(img ? { img } : {}),
    });
  }
  // 50 reply chains, replies right after their root; three of them have
  // exactly six replies where the scenarios fold them.
  const roots = new Map<number, number>();
  roots.set(SCENARIO_CHAINS.mid, 6);
  roots.set(SCENARIO_CHAINS.end, 6);
  roots.set(SCENARIO_CHAINS.deep, 6);
  while (roots.size < 50) {
    const at = 20 + Math.floor(r() * (COUNT - 60));
    let clash = false;
    for (const [k, n] of roots) if (Math.abs(k - at) < n + 12) clash = true;
    if (!clash) roots.set(at, 2 + Math.floor(r() * 7));
  }
  for (const [at, n] of roots) {
    const root = msgs[at] as Msg;
    root.replies = n;
    for (let j = 1; j <= n; j++) {
      const reply = msgs[at + j] as Msg;
      reply.root = root.id;
    }
  }
  return msgs;
}

export const MESSAGES: readonly Msg[] = build();

/** A new message (an arrival), after the fixture's newest. */
let arrivals = 0;
export function arrival(kind: MsgKind = "medium", author = 3): Msg {
  arrivals++;
  const r = rng(arrivals * 7919);
  const last = MESSAGES[MESSAGES.length - 1] as Msg;
  const text =
    kind === "long"
      ? `${sentence(r, 30, 45)}\n\n${sentence(r, 30, 45)}\n\n${sentence(r, 20, 30)}`
      : kind === "short"
        ? sentence(r, 2, 8)
        : `${sentence(r, 12, 22)} ${sentence(r, 10, 18)}`;
  return {
    id: `n${String(arrivals).padStart(4, "0")}`,
    seq: COUNT + arrivals,
    author,
    at: last.at + arrivals * 20_000,
    kind,
    text,
  };
}

/** Text an edit appends (grows a row by ~3 lines). */
export function editGrowth(): string {
  const r = rng(424242);
  return `\n\n${sentence(r, 30, 40)} ${sentence(r, 20, 30)}`;
}
