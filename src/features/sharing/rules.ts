/**
 * Pure sharing rules (PERM-3…8). Postgres `can_access` is the enforcement;
 * these helpers draw the UI and the tests that lock the product rules.
 */

import type { GrantLevel } from "@contracts/vocabularies";

export const GRANT_RANK: Record<GrantLevel, number> = {
  freebusy: 1,
  view: 2,
  edit: 3,
  full: 4,
};

/** Role ceiling: delete reaches Full, edit stops at Edit, view stops at View. */
export function ceilingRank(can: { view: boolean; edit: boolean; delete: boolean }): number {
  if (!can.view) return 0;
  if (can.delete) return 4;
  if (can.edit) return 3;
  return 2;
}

/** Stored grant, capped by the role. A missing grant is no access. */
export function effectiveRank(grant: GrantLevel | null, ceiling: number): number {
  if (!grant) return 0;
  return Math.min(GRANT_RANK[grant], ceiling);
}

export function rankAllows(rank: number, min: GrantLevel): boolean {
  return rank >= GRANT_RANK[min];
}

export type NoteShare = {
  id: string;
  parentId: string | null;
  shareMode: "inherit" | "custom";
  workspaceShared: boolean;
};

/** A note is private when its own (or inherited) access has no workspace grant. */
export function noteIsPrivate(noteId: string, notes: readonly NoteShare[]): boolean {
  let current = notes.find((n) => n.id === noteId) ?? null;
  for (let guard = 0; current && guard < 100; guard++) {
    if (current.shareMode !== "inherit" || !current.parentId)
      return current.workspaceShared === false;
    const parentId = current.parentId;
    current = notes.find((n) => n.id === parentId) ?? null;
  }
  return true;
}

/** Times present on every host's list, in chronological order. */
export function intersectSlotIso(lists: readonly (readonly string[])[]): string[] {
  if (lists.length === 0) return [];
  let set = new Set(lists[0]);
  for (const list of lists.slice(1)) {
    const next = new Set(list);
    set = new Set([...set].filter((iso) => next.has(iso)));
  }
  return [...set].sort();
}

/** Two contacts are the same person when both have the same email. */
export function sameContactEmail(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = a?.trim().toLowerCase() ?? "";
  const right = b?.trim().toLowerCase() ?? "";
  return left.length > 0 && left === right;
}

export function assignWarning(bucketName: string, personName: string): string {
  return `${personName} can't see "${bucketName}" — they'll only see this task.`;
}

/** Viewer (no tasks.edit) cannot be an assignee. */
export function canBeAssignee(perms: readonly string[]): boolean {
  return perms.includes("tasks.edit");
}

export const CHAT_CAP_DEFAULTS: Record<"admin" | "member" | "viewer", Record<string, boolean>> = {
  admin: {
    create_public: true,
    create_private: true,
    manage_any: true,
    delete_others: true,
    mention_everyone: true,
    post: true,
    start_calls: true,
  },
  member: {
    create_public: true,
    create_private: true,
    manage_any: false,
    delete_others: false,
    mention_everyone: true,
    post: true,
    start_calls: true,
  },
  viewer: {
    create_public: false,
    create_private: false,
    manage_any: false,
    delete_others: false,
    mention_everyone: false,
    post: false,
    start_calls: false,
  },
};
