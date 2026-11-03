// `;;` snippets with placeholders (E41, AC23). Typing `;;` then a name opens the
// snippet picker; picking one replaces the trigger with the snippet's body, its
// `{first name}`-style placeholders filled from the first recipient and you.
// Unknown placeholders stay as typed, so nothing is silently dropped.

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
  const full = name.trim() || email.split("@")[0] || "";
  const parts = full.split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.length > 1 ? parts[parts.length - 1] : "", full };
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
  return body.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    const v = values[key.trim().toLowerCase()];
    return v ? v : whole;
  });
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
