// MR-13 — the ⌘K mail operator parser (specs/mail-rebuild.md decision 17,
// AC32). Pure: ⌘K text in, the engine's structured `MailSearchQuery` out, plus
// the operator suggestions shown while one is being typed. Anything that isn't
// a known operator with a usable value stays a plain word, so a URL or a typo
// still searches as text.

import type { MailMailboxRole } from "@contracts/mail";

import type { MailSearchQuery } from "../../../lib/runtime.types.mail-engine";

export type SearchMailbox = { id: string; name: string; role: MailMailboxRole };

export type MailQueryContext = {
  /** Mailboxes `in:` can name by their display name (custom folders). */
  mailboxes?: readonly SearchMailbox[];
  /** Addresses `from:`/`to:` suggest. */
  people?: readonly string[];
};

const OPERATORS = ["from:", "to:", "subject:", "has:", "is:", "in:", "before:", "after:"] as const;
const IS_VALUES = ["unread", "pinned"] as const;
/** `in:` names that mean a role, the Moduo words included. */
const ROLE_ALIASES: Record<string, MailMailboxRole> = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  draft: "drafts",
  archive: "archive",
  done: "archive",
  all: "all",
  trash: "trash",
  bin: "trash",
  spam: "spam",
  junk: "spam",
};
const SUGGESTION_LIMIT = 6;

export function emptyMailQuery(): MailSearchQuery {
  return {
    words: [],
    from: [],
    to: [],
    subject: [],
    hasAttachment: false,
    isUnread: false,
    isPinned: false,
    inRole: null,
    inMailboxId: null,
    beforeMs: null,
    afterMs: null,
  };
}

export function isMailQueryEmpty(q: MailSearchQuery): boolean {
  return (
    q.words.length + q.from.length + q.to.length + q.subject.length === 0 &&
    !q.hasAttachment &&
    !q.isUnread &&
    !q.isPinned &&
    q.inRole === null &&
    q.inMailboxId === null &&
    q.beforeMs === null &&
    q.afterMs === null
  );
}

/** Split on whitespace, a `"…"` run (also after `op:`) kept as one token. */
function tokens(text: string): string[] {
  const out: string[] = [];
  const re = /(\S*?)"([^"]*)"?|(\S+)/g;
  for (const m of text.matchAll(re)) {
    if (m[3] !== undefined) out.push(m[3]);
    else out.push(`${m[1]}${m[2]}`);
  }
  return out.filter((t) => t.length > 0);
}

/** `YYYY-MM-DD` or `YYYY/MM/DD`, local midnight; null when it isn't a date. */
function dayStart(value: string): number | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date.getTime();
}

function resolveIn(value: string, ctx: MailQueryContext): Partial<MailSearchQuery> | null {
  const lower = value.toLowerCase();
  const named = ctx.mailboxes?.find(
    (mb) => mb.role === "custom" && mb.name.toLowerCase() === lower,
  );
  if (named) return { inMailboxId: named.id };
  const role = ROLE_ALIASES[lower];
  return role ? { inRole: role } : null;
}

/** `has:` / `is:` flags; false when the value is not one we know. */
function applyFlag(q: MailSearchQuery, op: string, lower: string): boolean {
  if (op === "has") {
    if (lower !== "attachment" && lower !== "attachments") return false;
    q.hasAttachment = true;
    return true;
  }
  if (lower === "unread") q.isUnread = true;
  else if (lower === "pinned") q.isPinned = true;
  else return false;
  return true;
}

/** One `op:value` token applied to `q`; false when it stays a word. */
function applyOperator(q: MailSearchQuery, token: string, ctx: MailQueryContext): boolean {
  const colon = token.indexOf(":");
  if (colon <= 0) return false;
  const op = token.slice(0, colon).toLowerCase();
  const value = token.slice(colon + 1).trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  switch (op) {
    case "from":
      q.from.push(value);
      return true;
    case "to":
      q.to.push(value);
      return true;
    case "subject":
      q.subject.push(value);
      return true;
    case "has":
    case "is":
      return applyFlag(q, op, lower);
    case "in": {
      const hit = resolveIn(value, ctx);
      if (!hit) return false;
      Object.assign(q, hit);
      return true;
    }
    case "before":
    case "after": {
      const ms = dayStart(value);
      if (ms === null) return false;
      if (op === "before") q.beforeMs = ms;
      else q.afterMs = ms;
      return true;
    }
    default:
      return false;
  }
}

export function parseMailQuery(text: string, ctx: MailQueryContext = {}): MailSearchQuery {
  const q = emptyMailQuery();
  for (const token of tokens(text)) {
    if (!applyOperator(q, token, ctx)) q.words.push(token);
  }
  return q;
}

export type MailQuerySuggestion = { label: string; text: string };

/** Values for the operator being typed in `last` (`op:partial`). */
function valueSuggestions(op: string, partial: string, ctx: MailQueryContext): string[] {
  const p = partial.toLowerCase();
  const starts = (v: string) => v.toLowerCase().startsWith(p) && v.toLowerCase() !== p;
  switch (op) {
    case "is":
      return IS_VALUES.filter(starts);
    case "has":
      return ["attachment"].filter(starts);
    case "in": {
      const names = [
        ...Object.keys(ROLE_ALIASES),
        ...(ctx.mailboxes ?? [])
          .filter((m) => m.role === "custom")
          .map((m) => m.name.toLowerCase()),
      ];
      return [...new Set(names)].filter(starts);
    }
    case "from":
    case "to":
      return p ? (ctx.people ?? []).filter((v) => v.toLowerCase().includes(p)) : [];
    default:
      return [];
  }
}

/**
 * Suggestions for the token being typed (the text after the last space): an
 * operator name it starts, or a value for the operator it is. Each carries the
 * whole ⌘K text to put in the input. A finished token suggests nothing.
 */
export function mailQuerySuggestions(
  text: string,
  ctx: MailQueryContext = {},
): MailQuerySuggestion[] {
  if (!text || /\s$/.test(text)) return [];
  const cut = text.lastIndexOf(" ") + 1;
  const head = text.slice(0, cut);
  const last = text.slice(cut);
  const colon = last.indexOf(":");
  if (colon < 0) {
    const lower = last.toLowerCase();
    return OPERATORS.filter((op) => op.startsWith(lower) && op !== lower)
      .slice(0, SUGGESTION_LIMIT)
      .map((op) => ({ label: op, text: `${head}${op}` }));
  }
  const op = last.slice(0, colon).toLowerCase();
  return valueSuggestions(op, last.slice(colon + 1), ctx)
    .slice(0, SUGGESTION_LIMIT)
    .map((v) => ({ label: `${op}:${v}`, text: `${head}${op}:${v} ` }));
}
