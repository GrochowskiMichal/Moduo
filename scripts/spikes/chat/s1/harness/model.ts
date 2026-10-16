// CV-0 spike 1: rows, the stream contract both libraries implement, and the
// row size estimates.

import { MESSAGES, type Msg, NOW } from "./fixture";

export type Density = "comfortable" | "compact" | "dense";
export const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];

export type Row =
  | { type: "day"; key: string; label: string }
  | { type: "msg"; key: string; msg: Msg; first: boolean; extra: string | null }
  | { type: "chain"; key: string; msg: Msg; first: boolean; extra: string | null; replies: number };

const DAY = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Today · Yesterday · Mon (up to six days back) · Oct 9 · Oct 9, 2025 (CH29c). */
export function dayLabel(at: number): string {
  const d = new Date(at);
  const today = Math.floor(NOW / DAY);
  const that = Math.floor(at / DAY);
  if (that === today) return "Today";
  if (that === today - 1) return "Yesterday";
  if (today - that < 7) return WEEKDAY[d.getUTCDay()] as string;
  const md = `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === new Date(NOW).getUTCFullYear()
    ? md
    : `${md}, ${d.getUTCFullYear()}`;
}

export type RowInput = {
  /** The loaded messages, oldest first. */
  messages: readonly Msg[];
  /**
   * The message just before the first loaded one, read but not drawn: it
   * decides the top row's grouping and whether a day separator sits above it,
   * so a later prepend never changes a row that is already drawn. `null`: the
   * conversation starts here. Leaving it out is the naive rule (the top row
   * always starts a group under a separator), kept to measure what it costs.
   */
  before?: Msg | null;
  /** Chain roots whose replies are folded into the root's row. */
  folded: ReadonlySet<string>;
  /** Message id → text an edit appended. */
  edits: ReadonlyMap<string, string>;
};

/** Messages → rows: day separators, group starts, folded chains, edits. */
export function buildRows(input: RowInput): Row[] {
  const rows: Row[] = [];
  const before = input.before ?? null;
  let prevDay: string | null = before ? dayKey(before.at) : null;
  let prevShown: Msg | null = before;
  let prevWasChain = before?.replies !== undefined && input.folded.has(before.id);
  // A separator whose day starts with a folded reply moves to the next shown row.
  let pending: Row | null = null;
  for (const msg of input.messages) {
    const day = dayKey(msg.at);
    if (prevDay === null || day !== prevDay) {
      pending = { type: "day", key: `d:${day}`, label: dayLabel(msg.at) };
    }
    prevDay = day;
    if (msg.root && input.folded.has(msg.root)) continue;
    const separator = pending !== null;
    if (pending) rows.push(pending);
    pending = null;
    const first =
      separator ||
      prevWasChain ||
      prevShown === null ||
      prevShown.author !== msg.author ||
      msg.at - prevShown.at > 5 * 60_000;
    const extra = input.edits.get(msg.id) ?? null;
    if (msg.replies && input.folded.has(msg.id)) {
      rows.push({
        type: "chain",
        key: `c:${msg.id}`,
        msg,
        first: true,
        extra,
        replies: msg.replies,
      });
      prevWasChain = true;
    } else {
      rows.push({ type: "msg", key: msg.id, msg, first, extra });
      prevWasChain = false;
    }
    prevShown = msg;
  }
  return rows;
}

/** Rows for a window [lo, hi) of the fixture plus arrivals. */
export function windowRows(
  lo: number,
  hi: number,
  arrivals: readonly Msg[],
  folded: ReadonlySet<string>,
  edits: ReadonlyMap<string, string>,
  edgeContext = true,
): Row[] {
  const messages = MESSAGES.slice(lo, hi);
  const all = arrivals.length ? [...messages, ...arrivals] : messages;
  return buildRows({
    messages: all,
    ...(edgeContext ? { before: lo > 0 ? (MESSAGES[lo - 1] as Msg) : null } : {}),
    folded,
    edits,
  });
}

const RHYTHM: Record<Density, { group: number; line: number }> = {
  comfortable: { group: 24, line: 6 },
  compact: { group: 20, line: 6 },
  dense: { group: 16, line: 6 },
};

/** A rough first guess per row kind (corrected once the row is drawn). */
export function estimateRow(row: Row, density: Density): number {
  if (row.type === "day") return 44;
  const r = RHYTHM[density];
  const top = row.first ? r.group + 22 : r.line;
  const msg = row.msg;
  let body = 22;
  if (msg.kind === "medium") body = 66;
  else if (msg.kind === "long") body = 200;
  else if (msg.kind === "code") body = 24 + msg.text.split("\n").length * 20;
  else if (msg.kind === "image" && msg.img) {
    const box = imageBox(msg.img);
    body = box.h + (msg.text ? 30 : 8);
  }
  if (row.extra) body += 66;
  if (row.type === "chain") body += 30;
  return top + body;
}

/** The image's reserved box: its stored size fit inside 360 × 240. */
export function imageBox(img: { w: number; h: number }): { w: number; h: number } {
  const scale = Math.min(360 / img.w, 240 / img.h, 1);
  return { w: Math.round(img.w * scale), h: Math.round(img.h * scale) };
}

/** What the runner may ask of a mounted stream (both libraries). */
export interface StreamApi {
  lib: string;
  scroller(): HTMLElement | null;
  scrollToKey(key: string, align: "start" | "center" | "end"): void;
  scrollToEnd(): void;
  /** TanStack only: set row sizes before the rows are drawn. */
  seedSizes?(sizes: ReadonlyMap<string, number>): void;
  /** TanStack only: the virtualizer itself, for diagnostics. */
  debug?(): Record<string, unknown>;
  /** Switch density and keep the anchor row in place in the same frame. */
  setDensityAnchored?(density: Density): void;
}

export type StreamConfig = {
  /** A short label for results. */
  id: string;
  useFlushSync: boolean;
  /** "default": TanStack's rule; "above": compensate any change entirely above the viewport. */
  adjust: "default" | "above";
  overflowAnchor: "none" | "auto";
  contain: boolean;
  directDom: boolean;
  overscan: number;
  /** "css": the image box keeps its stored size after decode; "attrs": width/height attributes only. */
  imageBox: "css" | "attrs";
};

export const BASE_CONFIG: StreamConfig = {
  id: "base",
  useFlushSync: false,
  adjust: "default",
  overflowAnchor: "none",
  contain: true,
  directDom: false,
  overscan: 6,
  imageBox: "css",
};

/** The candidate CV-7a would ship: flushSync on, every change above the viewport compensated. */
export const RECOMMENDED: StreamConfig = {
  ...BASE_CONFIG,
  id: "recommended",
  useFlushSync: true,
  adjust: "above",
};

export type StreamProps = {
  rows: readonly Row[];
  density: Density;
  config: StreamConfig;
  /** Open at the end, or centred on a row. */
  initial: { kind: "end" } | { kind: "key"; key: string };
  onApi: (api: StreamApi | null) => void;
};
