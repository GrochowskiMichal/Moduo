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

// C0 and C1 controls, DEL, the Unicode line/paragraph separators, the bidi
// marks and overrides (which can make a subject read backwards) and the BOM.
// Not U+200D: emoji sequences need it. Built from a string: SWC turns a
// literal U+2028 escape inside a regex literal into a raw line break and the
// test build fails to parse.
const CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]",
  "g",
);

/**
 * One line of plain text (a subject, a name): control characters and line
 * breaks become spaces, runs of whitespace collapse, and long values are cut
 * with an ellipsis. Not HTML-escaped; pass the result to escapeHtml for a body.
 */
export function singleLine(value: string, maxLength = 80): string {
  const flat = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  // Count and cut by code point, so an emoji is never split into a lone surrogate.
  const chars = Array.from(flat);
  if (chars.length <= maxLength) return flat;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join("").trimEnd()}…`;
}
