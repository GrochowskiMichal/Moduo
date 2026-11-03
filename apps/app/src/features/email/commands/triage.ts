// Triage commands on the mail engine (decision 11, AC11 UI half). The engine
// applies every op locally in the same call and owns the undo window; these
// commands keep the undo stack, so `z` undoes the last action: inside the
// window the engine cancels it, after it the engine queues the inverse.

import type { MailOpInput } from "@/lib/runtime.types.mail-engine";

import { type MailStore, mailStore, type MailUndoEntry, UNDO_STACK_MAX } from "../store/mail-store";

export type MailCommands = ReturnType<typeof createMailCommands>;

export function createMailCommands(store: MailStore = mailStore, now: () => number = Date.now) {
  const engineOrThrow = () => {
    const engine = store.getState().engine;
    if (!engine) throw new Error("Mail isn't running on this device");
    return engine;
  };

  const refreshFailed = async () => {
    const failedOps = await engineOrThrow().listFailedOps();
    store.setState({ failedOps });
  };

  return {
    /** Apply an op (Done, snooze, pin, …) and remember it for Undo. */
    async apply(input: MailOpInput): Promise<MailUndoEntry | null> {
      if (input.threadIds.length === 0) return null;
      const { opIds } = await engineOrThrow().applyOp(input);
      const entry: MailUndoEntry = {
        opIds,
        kind: input.kind,
        threadIds: [...input.threadIds],
        atMs: now(),
      };
      store.setState((s) => ({ undoStack: [...s.undoStack, entry].slice(-UNDO_STACK_MAX) }));
      return entry;
    },
    /** Undo the newest action (`z`), or the given one (a toast's Undo). */
    async undo(entry?: MailUndoEntry): Promise<boolean> {
      const stack = store.getState().undoStack;
      const target = entry ?? stack[stack.length - 1];
      if (!target || !stack.includes(target)) return false;
      store.setState((s) => ({ undoStack: s.undoStack.filter((e) => e !== target) }));
      const engine = engineOrThrow();
      for (const opId of [...target.opIds].reverse()) await engine.undoOp(opId);
      return true;
    },
    async retry(opId: string) {
      await engineOrThrow().retryOp(opId);
      await refreshFailed();
    },
    async discard(opId: string) {
      await engineOrThrow().discardOp(opId);
      await refreshFailed();
    },
    /** Dismiss a due follow-up nudge from the inbox top (X19). */
    dismissFollowup(threadId: string) {
      store.setState((s) => ({
        dismissedFollowups: s.dismissedFollowups.includes(threadId)
          ? s.dismissedFollowups
          : [...s.dismissedFollowups, threadId],
        followupsDue: s.followupsDue.filter((r) => r.threadId !== threadId),
      }));
    },
    /** The launch announcement was seen. */
    clearAwayAnnouncement() {
      store.setState({ awayReturned: [] });
    },
  };
}

/** The app's commands over the app's store. */
export const mailCommands = createMailCommands();
