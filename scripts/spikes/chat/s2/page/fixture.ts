// Deterministic chat messages for the browser benches: v2's row shape, with a
// body-length mix heavier than real chat (the research workspace's 3,032
// messages average 35 characters, max 119), so the numbers err high.

export type ChatRow = {
  id: string;
  workspaceId: string;
  channelId: string;
  parentId: string | null;
  replyToId: string | null;
  authorId: string | null;
  authorKind: "user" | "api_key";
  authorLabel: string | null;
  apiKeyId: string | null;
  body: string;
  formatVersion: number;
  kind: "message" | "event";
  event: { type: "moved_out" | "moved_in"; ids: string[]; to?: string; from?: string } | null;
  mentionedUserIds: string[];
  mentionedTeamIds: string[];
  mentionsEveryone: boolean;
  reactions: Record<string, string[]>;
  replyCount: number;
  lastReplyAt: string | null;
  replyUserIds: string[];
  pinnedAt: string | null;
  pinnedBy: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  decisionAt: string | null;
  decisionBy: string | null;
  movedAt: string | null;
  movedFromChannelId: string | null;
  createdAt: string;
  updatedAt: string;
  /** created_at in microseconds since the epoch: the device key's order. */
  at: number;
};

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuid(r: () => number): string {
  const h = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const WORDS =
  "zadanie projekt spotkanie klient żółw źdźbło gęśla jaźń termin wycena faktura budżet plan sprint wydanie review mockup ekran przycisk notatka kalendarz the launch deck copy brief draft call ship today tomorrow czwartek piątek poprawka błąd działa nie tak ok super dzięki".split(
    " ",
  );

function sentence(r: () => number, chars: number): string {
  let out = "";
  while (out.length < chars) out += `${WORDS[Math.floor(r() * WORDS.length)]} `;
  return out.slice(0, chars).trimEnd();
}

/** Body length: 60% short, 30% medium, 9% long, 1% very long. */
function bodyLength(r: () => number): number {
  const p = r();
  if (p < 0.6) return 20 + Math.floor(r() * 100);
  if (p < 0.9) return 120 + Math.floor(r() * 380);
  if (p < 0.99) return 500 + Math.floor(r() * 1500);
  return 2000 + Math.floor(r() * 4000);
}

export function microsToIso(at: number): string {
  const ms = Math.floor(at / 1000);
  const micros = String(at % 1_000_000).padStart(6, "0");
  return `${new Date(ms).toISOString().slice(0, 19)}.${micros}+00:00`;
}

export type FixtureOpts = {
  workspaceId: string;
  channelId: string;
  count: number;
  /** The first message's time, in microseconds. */
  startAt: number;
  /** Microseconds between messages. */
  stepMicros?: number;
  seed?: number;
  /** Fixed body length (the heap's worst case), else the mix above. */
  bodyChars?: number;
  people?: string[];
};

export function makeRows(o: FixtureOpts): ChatRow[] {
  const r = rng(o.seed ?? 1);
  const people = o.people ?? Array.from({ length: 12 }, () => uuid(r));
  const step = o.stepMicros ?? 97_000_000;
  const rows: ChatRow[] = [];
  for (let i = 0; i < o.count; i += 1) {
    const at = o.startAt + i * step;
    const iso = microsToIso(at);
    const author = people[Math.floor(r() * people.length)];
    const reacted = r() < 0.15;
    const mentions = r() < 0.1 ? [people[Math.floor(r() * people.length)]] : [];
    const replies = r() < 0.05 ? 1 + Math.floor(r() * 6) : 0;
    rows.push({
      id: uuid(r),
      workspaceId: o.workspaceId,
      channelId: o.channelId,
      parentId: null,
      replyToId: null,
      authorId: author,
      authorKind: "user",
      authorLabel: null,
      apiKeyId: null,
      body: sentence(r, o.bodyChars ?? bodyLength(r)),
      formatVersion: 2,
      kind: "message",
      event: null,
      mentionedUserIds: mentions,
      mentionedTeamIds: [],
      mentionsEveryone: false,
      reactions: reacted ? { "👍": [people[0], people[1]], "🎉": [people[2]] } : {},
      replyCount: replies,
      lastReplyAt: replies ? iso : null,
      replyUserIds: replies ? [people[3]] : [],
      pinnedAt: null,
      pinnedBy: null,
      editedAt: r() < 0.05 ? iso : null,
      deletedAt: null,
      decisionAt: null,
      decisionBy: null,
      movedAt: null,
      movedFromChannelId: null,
      createdAt: iso,
      updatedAt: iso,
      at,
    });
  }
  return rows;
}

/** A server stamp (`2026-10-14T10:00:00.123456+00:00`) in microseconds. */
export function micros(stamp: string): number {
  const m = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?/.exec(stamp);
  if (!m) return Date.parse(stamp) * 1000;
  return Date.parse(`${m[1]}T${m[2]}Z`) * 1000 + Number(`${m[3] ?? ""}000000`.slice(0, 6));
}
