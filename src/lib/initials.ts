/**
 * Two initials for an avatar (Tasks v3 call 43): the first and last names'
 * first letters, or a one-word name's first two letters, so teammates never
 * collapse to one letter. "?" for an empty name.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  const first = Array.from(parts[0])[0] ?? "";
  const last = Array.from(parts[parts.length - 1])[0] ?? "";
  return (first + last).toUpperCase();
}
