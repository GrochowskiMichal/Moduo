// Bulk triage (AC13): many selected threads, one op, one Undo entry. "Get me
// to zero" marks Done everything in a tab older than a day, week or month.

import type {
  MailOpInput,
  MailTab,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";

import { type MailStore, mailStore, type MailUndoEntry } from "../store/mail-store";
import { createMailCommands, type MailCommands } from "./triage";

export const ZERO_AGES = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 } as const;
export type ZeroAge = keyof typeof ZERO_AGES;

/** The threads "get me to zero" picks: strictly older than the cutoff. */
export function olderThan(rows: readonly MailThreadRow[], age: ZeroAge, nowMs: number): string[] {
  const cutoff = nowMs - ZERO_AGES[age];
  return rows.filter((r) => r.lastDateMs < cutoff).map((r) => r.threadId);
}

export function createBulkCommands(
  store: MailStore = mailStore,
  now: () => number = Date.now,
  commands: MailCommands = createMailCommands(store, now),
) {
  return {
    /** One undoable action over every selected thread. */
    apply(kind: MailOpInput["kind"], threadIds: readonly string[], args?: MailOpInput["args"]) {
      const ids = [...new Set(threadIds)];
      return commands.apply({ kind, threadIds: ids, ...(args ? { args } : {}) });
    },
    /** Done on everything in (view, tab) older than `age`, as one Undo entry. */
    async getMeToZero(
      view: MailView,
      tab: MailTab | null,
      age: ZeroAge,
    ): Promise<MailUndoEntry | null> {
      const engine = store.getState().engine;
      if (!engine) throw new Error("Mail isn't running on this device");
      const cutoff = now() - ZERO_AGES[age];
      const ids: string[] = [];
      let after = null;
      do {
        const page = await engine.listThreads({ view, tab, after, limit: 500 });
        for (const r of page.rows) if (r.lastDateMs < cutoff) ids.push(r.threadId);
        after = page.next;
      } while (after);
      return commands.apply({ kind: "done", threadIds: ids });
    },
  };
}
