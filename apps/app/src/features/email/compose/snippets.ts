// `;;` snippets with placeholders (E41, AC23). Typing `;;` then a name opens the
// snippet picker; picking one replaces the trigger with the snippet's body, its
// `{first name}`-style placeholders filled from the first recipient and you.
// Unknown placeholders stay as typed, so nothing is silently dropped; a known
// one with no value (no recipient yet) becomes "" and its gap closes.

export type MailSnippet = { id: string; name: string; body: string };

export type SnippetContext = {
  recipient?: { name: string; email: string } | null;
  me?: { name: string; email: string } | null;
};

/** The `;;query` the caret sits right after, or null. */
export function findSnippetTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\s);;([\p{L}\p{N}_-]*)$/u);
  if (!m) return null;
  return { start: caret - m[1].length - 2, query: m[1] };
}

export function matchSnippets(snippets: MailSnippet[], query: string): MailSnippet[] {
  const q = query.toLowerCase();
  return snippets
    .filter((s) => s.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    });
}

function splitName(name: string, email: string): { first: string; last: string; full: string } {
  // The display name first; the address's local part only when there is no name.
  const full = name.trim() || email.split("@")[0] || "";
  const parts = full.split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts[parts.length - 1] : "", full };
}

/** Placeholders a snippet may use; a known one with no value fills with "". */
const KNOWN = new Set([
  "first name",
  "last name",
  "name",
  "email",
  "my name",
  "my first name",
  "my email",
]);

const EMPTIED = "\uE000";

/** Closes the gap emptied placeholders leave: "Thanks {first name} for" → "Thanks for",
 *  "Hi {first name}, thanks" → "Hi, thanks". */
function closeGaps(text: string): string {
  return text.replace(/[ \t]*(?:\uE000[ \t]*)+/g, (m: string, at: number, all: string) => {
    const next = all[at + m.length] ?? "";
    const prev = at > 0 ? all[at - 1]! : "";
    if (next === "" || prev === "" || /[,.;:!?)\n]/.test(next) || prev === "\n") return "";
    return /[ \t]/.test(m) ? " " : "";
  });
}

export function fillPlaceholders(body: string, ctx: SnippetContext): string {
  const r = ctx.recipient ? splitName(ctx.recipient.name, ctx.recipient.email) : null;
  const me = ctx.me ? splitName(ctx.me.name, ctx.me.email) : null;
  const values: Record<string, string | undefined> = {
    "first name": r?.first,
    "last name": r?.last,
    name: r?.full,
    email: ctx.recipient?.email,
    "my name": me?.full,
    "my first name": me?.first,
    "my email": ctx.me?.email,
  };
  const filled = body.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    const k = key.trim().toLowerCase();
    const v = values[k];
    if (v) return v;
    return KNOWN.has(k) ? EMPTIED : whole;
  });
  return filled.includes(EMPTIED) ? closeGaps(filled) : filled;
}

/**
 * The person a snippet's `{first name}` is about: the first To entry, named by
 * its own "Name <addr>" form, else a known contact or correspondent, else unnamed.
 */
export function snippetRecipient(
  to: string,
  known: readonly { name: string; email: string }[] = [],
): { name: string; email: string } | null {
  const raw = to.split(",")[0]?.trim() ?? "";
  if (!raw) return null;
  const angle = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  const email = (angle ? angle[2]! : raw).trim();
  const own = angle?.[1]?.trim() ?? "";
  const hit = known.find((k) => k.name && k.email.toLowerCase() === email.toLowerCase());
  return { name: own || hit?.name || "", email };
}

/** The popup's line when no snippet has that key (specs/mail-v3.md §9). */
export function snippetMissLine(key: string): string {
  return `No snippet called ;;${key}. Make one in Settings → Mail → Snippets.`;
}

/** A snippet's one-line preview with its placeholders filled. */
export function snippetPreview(snippet: MailSnippet, ctx: SnippetContext): string {
  return fillPlaceholders(snippet.body, ctx).replace(/\s+/g, " ").trim();
}

/** Replaces the trigger with the filled snippet; returns the new text and caret. */
export function insertSnippet(
  text: string,
  caret: number,
  snippet: MailSnippet,
  ctx: SnippetContext,
): { text: string; caret: number } | null {
  const trigger = findSnippetTrigger(text, caret);
  if (!trigger) return null;
  const filled = fillPlaceholders(snippet.body, ctx);
  return {
    text: text.slice(0, trigger.start) + filled + text.slice(caret),
    caret: trigger.start + filled.length,
  };
}
