// The parsed tree, kept per message: a row is drawn from it and re-parsed
// only when the message's `updated_at` moves (an edit, a delete, a move).
// Bounded like the store's in-memory window (~1,500 messages), least recently
// used first out.

import { parseStored } from "./parse";
import type { Block } from "./types";

type Entry = { updatedAt: string; body: string; tree: Block[] };

export const TREE_CACHE_LIMIT = 2_000;

const cache = new Map<string, Entry>();

/**
 * The tree for message `id` as of `updatedAt`. A hit needs the same stamp and
 * body (an optimistic row's body can change before the server stamps it).
 */
export function messageTree(id: string, updatedAt: string, body: string): Block[] {
  const hit = cache.get(id);
  if (hit && hit.updatedAt === updatedAt && hit.body === body) {
    // Refresh its place in the eviction order.
    cache.delete(id);
    cache.set(id, hit);
    return hit.tree;
  }
  const tree = parseStored(body);
  cache.delete(id);
  cache.set(id, { updatedAt, body, tree });
  if (cache.size > TREE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return tree;
}

/** Forget one message (deleted, moved out) or everything (sign-out, tests). */
export function forgetMessageTree(id?: string): void {
  if (id === undefined) cache.clear();
  else cache.delete(id);
}

/** How many trees are held (tests, the perf fixture). */
export function messageTreeCount(): number {
  return cache.size;
}
