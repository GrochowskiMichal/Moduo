// Contacts module — alphabetical letter index. PURE: no React, no side effects.
//
// Buckets an arbitrary item list (contacts, companies, …) under its leading
// A–Z letter for the directory's jump-list rail. Anything that doesn't start
// with a Latin letter — digits, symbols, accented/CJK glyphs, empty — falls into
// a single trailing '#' bucket so the rail stays a fixed A–Z(+#) shape.

/** A single alphabetical bucket: an uppercase letter (A–Z) or '#', plus its items. */
export type LetterGroup<T> = { letter: string; items: T[] };

/** The non-letter bucket key, sorted last. */
const OTHER = "#";

/**
 * The bucket key for a name: its first character uppercased if it's a Latin
 * letter A–Z, else '#'. We intentionally only treat ASCII A–Z as letters —
 * accented/non-Latin/digit/symbol/empty leads all collapse to '#' (spec).
 */
function letterOf(name: string): string {
  const first = name.charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : OTHER;
}

/** Compare keys A→Z, with '#' forced last. */
function compareLetters(a: string, b: string): number {
  if (a === b) return 0;
  if (a === OTHER) return 1;
  if (b === OTHER) return -1;
  return a < b ? -1 : 1;
}

/**
 * Group `items` by the first alphabetic character of `nameOf(item)`.
 *
 * - Keys are uppercased A–Z; non-letter leads bucket under '#'.
 * - Groups are sorted A→Z then '#' last; empty groups are omitted.
 * - Items within a group are sorted case-insensitively by name (locale-aware,
 *   stable as guaranteed by Array.prototype.sort).
 */
export function groupByLetter<T>(items: T[], nameOf: (t: T) => string): LetterGroup<T>[] {
  const buckets = new Map<string, T[]>();

  for (const item of items) {
    const key = letterOf(nameOf(item));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => compareLetters(a, b))
    .map(([letter, groupItems]) => ({
      letter,
      // Case-insensitive, locale-aware sort of items by their display name.
      items: groupItems.sort((x, y) =>
        nameOf(x).localeCompare(nameOf(y), undefined, { sensitivity: "base" }),
      ),
    }));
}
