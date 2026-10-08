/**
 * Escaping for text we put into emails. Anything a user can type (a name, a
 * workspace name, a booking note) goes through one of these before it lands
 * in an HTML body or a subject line.
 */

/** Text for an HTML body or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Text for an HTML field someone else renders and mails on (a Google event
 * description): angle brackets go, so it can't carry a tag. Unlike
 * escapeHtml it needs no decoding, so it reads the same as plain text.
 */
export function noTags(value: string): string {
  return value.replace(/[<>]/g, "");
}

// C0 controls, DEL and the Unicode line/paragraph separators. Built from a
// string: SWC turns a literal U+2028 escape inside a regex literal into a raw
// line break and the test build fails to parse.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029]", "g");

/**
 * One line of plain text (a subject, a name): control characters and line
 * breaks become spaces, runs of whitespace collapse, and long values are cut
 * with an ellipsis. Not HTML-escaped; pass the result to escapeHtml for a body.
 */
export function singleLine(value: string, maxLength = 80): string {
  const flat = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  return `${flat.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
