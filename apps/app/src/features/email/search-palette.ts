// GS-9 — Email in the ⌘K palette (specs/global-search.md AC12, Assumption 15,
// Q17, Q17b). Pure: unit-tested in search-palette.test.ts.
//
// The inbox never leaves the desktop (EM-3), so mail isn't on `search_all`
// except the threads deliberately pulled into Moduo (`email_refs`, owner-only).
// On desktop the palette adds this device's own mail search (the instant
// envelope match plus the Rust body scan, `search.ts`) to the Email group here,
// in the client: inbox-only and only for accounts connected on this device, as
// every local search is (EM-9 (c)), newest first. On web nothing is added.

import type { SearchAllRow } from "@contracts/search";
import { SEARCH_SNIPPET_END, SEARCH_SNIPPET_START } from "@contracts/search";

import type { EmailEnvelope, EmailThread, SavedAccount } from "./model/email-types";
import { mergeHits } from "./search";
import { shapeInboxThreads } from "./threads";

const MAIL_TYPES = new Set(["email_thread", "email"]);
/** The most a group counts ("Show all 50+"), as the server caps `type_total`. */
const TOTAL_CAP = 50;
/** A body snippet's reach on each side of the first hit. */
const SNIPPET_LEAD = 40;
const SNIPPET_LENGTH = 120;

type QueryTerms = { words: string[]; excluded: string[] };

/** The query's words, lowercased: quotes dropped, `-word` set apart. */
function queryTerms(query: string): QueryTerms {
  const words: string[] = [];
  const excluded: string[] = [];
  for (const raw of query.replace(/"/g, " ").toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith("-")) {
      if (raw.length > 1) excluded.push(raw.slice(1));
    } else {
      words.push(raw);
    }
  }
  return { words, excluded };
}

/** Searched at all: two characters or more and a word that isn't excluded (as
 * the palette's `searchableQuery`). */
function searchedTerms(query: string): QueryTerms | null {
  const q = query.trim();
  if (q.length < 2) return null;
  const terms = queryTerms(q);
  return terms.words.length > 0 ? terms : null;
}

/** What the Rust body scan looks for (one lowercase substring): the query's
 * words without quotes or excluded words. Null = don't scan. */
export function mailBodyQuery(query: string): string | null {
  const terms = searchedTerms(query);
  return terms ? terms.words.join(" ") : null;
}

function envelopeText(env: EmailEnvelope): string {
  return [env.sender, env.senderEmail, env.to, env.cc ?? "", env.subject, env.preview]
    .join(" ")
    .toLowerCase();
}

/** The preview around the first word it holds, that word marked; null when
 * the preview holds none (the hit is deeper in the body). */
function bodySnippet(preview: string, words: readonly string[]): string | null {
  const lower = preview.toLowerCase();
  let at = -1;
  let word = "";
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      word = w;
    }
  }
  if (at < 0) return null;
  const start = Math.max(0, at - SNIPPET_LEAD);
  const end = Math.min(preview.length, Math.max(at + word.length, start + SNIPPET_LENGTH));
  return `${start > 0 ? "…" : ""}${preview.slice(start, at)}${SEARCH_SNIPPET_START}${preview.slice(
    at,
    at + word.length,
  )}${SEARCH_SNIPPET_END}${preview.slice(at + word.length, end)}${end < preview.length ? "…" : ""}`;
}

function threadRow(
  thread: EmailThread,
  words: readonly string[],
  refIdByThread: ReadonlyMap<string, string>,
): SearchAllRow {
  const subject = thread.subject.toLowerCase();
  const inTitle = words.every((w) => subject.includes(w));
  return {
    entity_type: "email_thread",
    // A thread pulled into Moduo goes by its `email_refs` id, so it is one row
    // with the server's; entity-open takes either id (DF-2).
    entity_id: refIdByThread.get(thread.threadId) ?? thread.threadId,
    title: thread.subject,
    context: thread.fromName.trim() || thread.fromEmail || null,
    snippet: inTitle ? null : bodySnippet(thread.snippet, words),
    icon: null,
    match: inTitle ? "title" : "body",
    rank: inTitle ? 0.5 : 0.25,
    updated_at: new Date(thread.timestampMs).toISOString(),
    archived: false,
    score: inTitle ? 0.5 : 0.25,
    type_total: 0,
    top: false,
  };
}

/**
 * This device's mail matches as Email rows, newest first: the instant envelope
 * match (every word, in any order, over sender, recipients, subject and
 * preview; an excluded word drops the message) merged with the Rust body
 * scan's hits, deduped per message, shaped into threads. Inbox only, and only
 * accounts connected here.
 */
export function localMailRows(input: {
  envelopes: readonly EmailEnvelope[];
  bodyHits: readonly EmailEnvelope[];
  accounts: readonly SavedAccount[];
  refs: ReadonlyArray<{ id: string; threadKey: string }>;
  query: string;
}): SearchAllRow[] {
  const terms = searchedTerms(input.query);
  if (!terms) return [];
  const connected = new Set(input.accounts.map((a) => a.id));
  const inScope = (env: EmailEnvelope) => env.folder === "inbox" && connected.has(env.accountId);
  const notExcluded = (env: EmailEnvelope) => {
    const text = envelopeText(env);
    return terms.excluded.every((w) => !text.includes(w));
  };
  const instant = input.envelopes.filter((env) => {
    if (!inScope(env)) return false;
    const text = envelopeText(env);
    return terms.words.every((w) => text.includes(w)) && notExcluded(env);
  });
  const body = input.bodyHits.filter((env) => inScope(env) && notExcluded(env));
  const threads = shapeInboxThreads(mergeHits(instant, body), [...input.accounts]);
  const refIdByThread = new Map(input.refs.map((r) => [r.threadKey, r.id] as const));
  return threads
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .map((t) => threadRow(t, terms.words, refIdByThread));
}

const isMail = (row: SearchAllRow) => MAIL_TYPES.has(row.entity_type);
const timeOf = (row: SearchAllRow) => {
  const ms = Date.parse(row.updated_at);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * The server's answer with this device's mail folded into its Email group.
 * `local` null (web) returns the server's rows untouched. Otherwise the Email
 * rows are this device's and the server's pulled-in threads, one row per
 * thread (this device's copy wins, keeping the server's Top mark), newest
 * first, after every other row; each counts the group's total for "Show all N",
 * the server's unsent matches included.
 */
export function mergeMailRows(
  server: readonly SearchAllRow[],
  local: readonly SearchAllRow[] | null,
): SearchAllRow[] {
  if (local === null) return [...server];
  const others = server.filter((r) => !isMail(r));
  const serverMail = server.filter(isMail);
  const serverById = new Map(serverMail.map((r) => [r.entity_id, r] as const));
  const localIds = new Set(local.map((r) => r.entity_id));
  const mail = [
    ...local.map((r) => (serverById.get(r.entity_id)?.top ? { ...r, top: true } : r)),
    ...serverMail.filter((r) => !localIds.has(r.entity_id)),
  ].sort((a, b) => timeOf(b) - timeOf(a));
  const serverTotal = serverMail.reduce((n, r) => Math.max(n, r.type_total), 0);
  const unsent = Math.max(0, serverTotal - serverMail.length);
  const total = Math.min(TOTAL_CAP, mail.length + unsent);
  return [
    ...others,
    ...mail.map((r) => ({ ...r, entity_type: "email_thread", type_total: total })),
  ];
}
