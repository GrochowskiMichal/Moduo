/**
 * Quote-comments (NO-7, AC9) — a comment can quote a snippet of the note.
 *
 * No schema change: CT-5's `comments` table has no quote column, so the quote
 * rides in the comment body as a leading markdown blockquote. It therefore
 * round-trips through storage, the MCP connector, and the notifications feed as
 * plain, human-readable markdown (matching the "markdown at every boundary"
 * ethos), and needs no migration.
 *
 *   > the quoted snippet
 *
 *   the actual comment
 */

/** Format a comment body carrying an optional quoted snippet. */
export function formatQuoteComment(quote: string | null | undefined, text: string): string {
  const body = text.trim();
  const q = quote?.trim();
  if (!q) return body;
  const quoted = q
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
  return body ? `${quoted}\n\n${body}` : quoted;
}

export type ParsedComment = { quote: string | null; text: string };

/** Split a stored comment body back into its leading quote (if any) + text. */
export function parseQuoteComment(body: string): ParsedComment {
  const lines = body.split("\n");
  let i = 0;
  const quoteLines: string[] = [];
  while (i < lines.length && /^>\s?/.test(lines[i])) {
    quoteLines.push(lines[i].replace(/^>\s?/, ""));
    i++;
  }
  if (quoteLines.length === 0) return { quote: null, text: body };
  // Skip the blank separator line(s) between the quote and the comment text.
  while (i < lines.length && lines[i].trim() === "") i++;
  return { quote: quoteLines.join("\n").trim(), text: lines.slice(i).join("\n").trim() };
}

/** Collapse whitespace for tolerant matching (the editor may re-wrap text). */
function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Find where a quoted snippet appears in the note's current text, tolerant of
 * whitespace re-wrapping. Returns the char offset in the NORMALIZED haystack,
 * or null when the quoted text was edited away — the comment then degrades to
 * quote-only (AC9). The offset is into `normalizeForMatch(haystack)`; callers
 * use a non-null result only as a "found → scroll" signal.
 */
export function findQuoteOffset(haystack: string, quote: string): number | null {
  const q = normalizeForMatch(quote);
  if (!q) return null;
  const i = normalizeForMatch(haystack).indexOf(q);
  return i >= 0 ? i : null;
}
