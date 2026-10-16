// The access check (CV-3, spike 2 bar 5, round-3 §2.7): losing access sends no
// event. Removed from a private conversation, the conversation deleted, made
// private (read from Browse, never joined), messages moved somewhere you can't
// read: none of it shows up in a delta, so `chat_sync_ids` says what you may
// read now and the store drops everything else it holds, in memory and on the
// device. It sees only the conversations the store knows it holds (memory ∪
// `meta.conversations`), which is why every conversation the store persists
// rows for is registered there first.

import type { ChatSyncRow } from "../model";

export type AccessPlan = {
  /** Held conversations you can no longer read: out of memory and off the device. */
  dropConversations: string[];
  /** Messages moved into a conversation you can't read (or gone), since the last check. */
  dropIds: string[];
  /** Every conversation you may read now. */
  readable: ReadonlySet<string>;
  /** Your live memberships now. */
  member: ReadonlySet<string>;
  /** The server's clock at the check: the next check's `since`. */
  checkedAt: string;
};

/**
 * What to drop after a check. Null when the answer has no `checked` row (it
 * always ends with one): an answer that isn't whole drops nothing.
 */
export function planAccess(
  held: Iterable<string>,
  rows: readonly ChatSyncRow[],
): AccessPlan | null {
  const readable = new Set<string>();
  const member = new Set<string>();
  const dropIds: string[] = [];
  let checkedAt: string | null = null;
  for (const row of rows) {
    if (row.kind === "checked") checkedAt = row.checkedAt;
    else if (row.kind === "conversation" && row.id) readable.add(row.id);
    else if (row.kind === "member" && row.id) member.add(row.id);
    else if (row.kind === "moved_away" && row.id) dropIds.push(row.id);
  }
  if (!checkedAt) return null;
  const dropConversations = [...new Set(held)].filter((id) => !readable.has(id));
  return { dropConversations, dropIds, readable, member, checkedAt };
}
