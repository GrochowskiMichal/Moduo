// Pure tag selectors shared by every tag surface (tasks-v2 TV-T1).

import type { Tag } from "../tasks/model";

/** Case-insensitive, trimmed name match against live tags (create-or-attach dedupe). */
export function findTagByName(all: readonly Tag[], name: string): Tag | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return all.find((t) => !t.deletedAt && t.name.trim().toLowerCase() === needle);
}
