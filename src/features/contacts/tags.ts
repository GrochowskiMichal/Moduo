// Pure tag selectors for the contact/company tag row (fix pack FX-2, AC3).
// The hook does the IO; these fold tags + links into what the row renders.
// Unit-tested in tags.test.ts.

import type { Tag, TagLink } from "../tasks/model";

/** The live tags attached to the focus entity, name-sorted (matches Tasks). */
export function attachedTags(all: Tag[], links: TagLink[]): Tag[] {
  const linked = new Set(links.map((l) => l.tagId));
  return all
    .filter((t) => !t.deletedAt && linked.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive name match against live tags (create-dedupe, mirrors Tasks). */
export function findTagByName(all: Tag[], name: string): Tag | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return all.find((t) => !t.deletedAt && t.name.trim().toLowerCase() === needle);
}
