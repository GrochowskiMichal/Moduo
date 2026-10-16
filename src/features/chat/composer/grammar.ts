// The chat composer's grammar, the pure half (specs/chat-v2.md §4, §16; CV-7b).
// `@` finds people first, then `@channel`, then things; `/` runs commands
// (`/task` `/note` `/event` open the app's capture, the date commands come
// from the shared menu); a pasted Moduo link becomes the same reference a
// pick makes. The limit is 8,000 stored characters, references included,
// refused with the count and nothing partial (§6 #3). No React, no Lexical.

import { canonicalBlocks } from "../markup-v2/canonical";
import type { Block, Inline } from "../markup-v2/types";
import { UUID_SOURCE } from "../markup-v2/types";

/** The most a message may hold, in stored characters (references included). */
export const MESSAGE_LIMIT = 8000;

/** Over the limit: how many stored characters the message has; else null. */
export function overLimit(stored: string): number | null {
  return stored.length > MESSAGE_LIMIT ? stored.length : null;
}

/** What the composer says when a message is too long (nothing is sent). */
export function limitCopy(count: number): string {
  return `This message is ${count.toLocaleString("en-US")} characters. The limit is ${MESSAGE_LIMIT.toLocaleString("en-US")}; nothing was sent.`;
}

/** After a send whose `@channel` the server kept as text (copy #33). */
export const CHANNEL_REFUSED_COPY =
  "Only roles that may mention everyone can use @channel; it was sent as text.";

// ── `/` commands that create ────────────────────────────────────────────────

export type CreateCommand = "task" | "note" | "event";

export const CREATE_COMMANDS: ReadonlyArray<{ id: CreateCommand; label: string }> = [
  { id: "task", label: "Task" },
  { id: "note", label: "Note" },
  { id: "event", label: "Event" },
];

/**
 * The create commands a `/` query offers, with the words after the command
 * (the new item's title). `/ta` offers Task; `/task Order frames` offers Task
 * with "Order frames"; `/tasks` and `/takeaway` offer nothing.
 */
export function createCommandsFor(query: string): Array<{ id: CreateCommand; title: string }> {
  const q = query.replace(/^\s+/, "");
  const space = q.search(/\s/);
  const word = (space === -1 ? q : q.slice(0, space)).toLowerCase();
  const rest = space === -1 ? "" : q.slice(space).trim();
  return CREATE_COMMANDS.filter((c) => (space === -1 ? c.id.startsWith(word) : c.id === word)).map(
    (c) => ({ id: c.id, title: rest }),
  );
}

/** Whether a `/` query offers `/remind` (CV-11): its word so far, nothing after it. */
export function remindMatches(query: string): boolean {
  const q = query.replace(/^\s+/, "").toLowerCase();
  return !/\s/.test(q) && "remind".startsWith(q);
}

// ── `@`: people first ───────────────────────────────────────────────────────

export type MentionablePerson = { id: string; name: string; email?: string | null };

/**
 * The people an `@` query offers, best first: a name that starts with the
 * query, then a word in the name that does, then anything containing it.
 * You are left out (mentioning yourself pings nobody).
 */
export function peopleFor(
  people: readonly MentionablePerson[],
  query: string,
  selfId: string | null,
  limit = 6,
): MentionablePerson[] {
  const q = query.trim().toLowerCase();
  const scored: Array<{ p: MentionablePerson; score: number }> = [];
  for (const p of people) {
    if (p.id === selfId) continue;
    const name = p.name.toLowerCase();
    const email = (p.email ?? "").toLowerCase();
    let score = -1;
    if (!q || name.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
    else if (name.includes(q) || email.startsWith(q)) score = 2;
    if (score >= 0) scored.push({ p, score });
  }
  scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, limit).map((s) => s.p);
}

/** Whether an `@` query offers `@channel` (the word, or the start of it). */
export function offersChannel(query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length > 0 && ("channel".startsWith(q) || "everyone".startsWith(q));
}

// ── pasted Moduo links ──────────────────────────────────────────────────────

const UUID = new RegExp(`^${UUID_SOURCE}$`);

/**
 * The item a Moduo link opens, when it's one of the app's own deep links
 * (the inverse of lib/entity-open.ts): `/tasks?id=`, `/notes?id=`,
 * `/calendar?event=`, `/contacts?type=&id=`, `/email?thread=`, `/chat?c=`.
 * Only on one of `origins` (this app's), and only for an id (a task handle
 * link is CV-10's handle chip).
 */
export function appLinkRef(
  href: string,
  origins: readonly string[],
): { type: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!origins.includes(url.origin)) return null;
  const q = url.searchParams;
  const id = (key: string) => {
    const v = q.get(key);
    return v && UUID.test(v) ? v : null;
  };
  switch (url.pathname.replace(/\/+$/, "")) {
    case "/tasks": {
      const v = id("id");
      return v ? { type: "task", id: v } : null;
    }
    case "/notes": {
      const v = id("id");
      return v ? { type: "note", id: v } : null;
    }
    case "/calendar": {
      const v = id("event");
      return v ? { type: "event", id: v } : null;
    }
    case "/contacts": {
      const v = id("id");
      const type = q.get("type");
      return v && (type === "contact" || type === "company") ? { type, id: v } : null;
    }
    case "/email": {
      const v = id("thread");
      return v ? { type: "email_thread", id: v } : null;
    }
    case "/chat": {
      // A link to a message is a link to its conversation (the message's own
      // reference is CV-10's "Mentioned in").
      const v = id("c");
      return v ? { type: "chat_channel", id: v } : null;
    }
    default:
      return null;
  }
}

function linkInline(leaves: readonly Inline[], origins: readonly string[]): Inline[] {
  return leaves.map((leaf): Inline => {
    if (leaf.t === "url") {
      const ref = appLinkRef(leaf.v, origins);
      return ref ? { t: "ref", type: ref.type, id: ref.id } : leaf;
    }
    if (leaf.t === "link") {
      // A labelled link whose label is just its address reads as the bare link.
      const label = leaf.c.map((c) => c.v).join("");
      const ref = label === leaf.href ? appLinkRef(leaf.href, origins) : null;
      return ref ? { t: "ref", type: ref.type, id: ref.id } : leaf;
    }
    return leaf;
  });
}

/** A pasted tree with this app's own links turned into references (the same chip as a pick). */
export function linkAppRefs(blocks: readonly Block[], origins: readonly string[]): Block[] {
  if (origins.length === 0) return [...blocks];
  return canonicalBlocks(
    blocks.map((block): Block => {
      if (block.t === "p") return { t: "p", c: linkInline(block.c, origins) };
      if (block.t === "quote") return { t: "quote", c: linkInline(block.c, origins) };
      if (block.t === "list") {
        return { ...block, items: block.items.map((item) => linkInline(item, origins)) };
      }
      return block;
    }),
  );
}

// ── the composer's keys (§16) ───────────────────────────────────────────────

export type ComposerKeyAction = "edit-last" | "to-stream" | null;

/**
 * What ↑ and Esc do in the message composer: ↑ in an empty composer edits your
 * last message; Esc in an empty one, with nothing else open, moves focus to
 * the newest message (the last step of the Esc order). A menu that's open
 * takes both keys first.
 */
export function composerKeyAction(input: {
  key: string;
  empty: boolean;
  menuOpen: boolean;
  modifiers: boolean;
}): ComposerKeyAction {
  if (input.menuOpen || input.modifiers || !input.empty) return null;
  if (input.key === "ArrowUp") return "edit-last";
  if (input.key === "Escape") return "to-stream";
  return null;
}
