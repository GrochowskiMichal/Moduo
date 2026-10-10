/**
 * Two letters for an avatar or a team mark (Tasks v3 calls 43 and 95). One
 * rule for the whole app: the kit's `PersonAvatar` / `TeamMark`
 * (src/components/ui/avatar.tsx), the account menu and the comment avatars all
 * read it, so teammates never collapse to one letter anywhere.
 */

const firstLetter = (word: string) => [...word][0] ?? "";

/** Words of a name; an email's local part is split on `.`, `_` and `-` too. */
function nameWords(name: string): string[] {
  const trimmed = name.trim();
  const base = /^\S+@\S+$/.test(trimmed) ? trimmed.slice(0, trimmed.indexOf("@")) : trimmed;
  return base
    .split(/[\s._-]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
}

/**
 * A person's two initials (call 43): first and last word ("Maciej Grzywacz" →
 * "MG"), or the first two letters of a single word ("Maciej" → "MA", "Mike" →
 * "MI"), so two people who share a first letter still differ. Never one letter
 * and never "Me": pass the person's own name, not a pronoun.
 */
export function initialsOf(name: string | null | undefined): string {
  const words = nameWords(name ?? "");
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]].slice(0, 2).join("").toUpperCase();
  return (firstLetter(words[0]) + firstLetter(words[words.length - 1])).toUpperCase();
}

/**
 * A team's two automatic letters (call 95): the first letters of the first two
 * words ("Customer success" → "CS"), or a single word's first letter plus its
 * next consonant ("Design" → "DS", "Development" → "DV"). A team can edit its
 * letters (TV-D10 stores them); pass them as `letters` when set.
 */
export function teamLettersOf(name: string | null | undefined): string {
  const words = nameWords(name ?? "");
  if (words.length === 0) return "?";
  if (words.length > 1) return (firstLetter(words[0]) + firstLetter(words[1])).toUpperCase();
  const letters = [...words[0]];
  const consonant = letters.slice(1).find((ch) => /\p{L}/u.test(ch) && !/[aeiouy]/i.test(ch));
  return (letters[0] + (consonant ?? letters[1] ?? "")).toUpperCase();
}
