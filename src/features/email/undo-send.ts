// The 10s undo-send hold (EM-7, AC11). A pure, timer-injectable controller so the
// rule is unit-testable: a send fires ONLY after the window elapses; Undo (or an
// app-quit / unmount) cancels it and hands back the draft to restore/stash — the
// mail never leaves inside the window (JS owns the timer; there is no server queue,
// so quitting inside the window is a guaranteed no-send). The hook wraps this with
// real timers + a toast + localStorage draft stash.

export const SEND_UNDO_MS = 10_000;

export type SendHold<TInput, TDraft> = {
  /** Begin the hold — replaces any in-flight one. */
  start(input: TInput, draft: TDraft): void;
  /** User pressed Undo: cancel, return the draft to reopen (or null). */
  undo(): TDraft | null;
  /** Unmount/quit: cancel WITHOUT sending, return the draft to stash (or null). */
  abandon(): TDraft | null;
  /** Is a send currently held? */
  pending(): boolean;
};

export function createSendHold<TInput, TDraft>(opts: {
  delayMs: number;
  send: (input: TInput) => void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}): SendHold<TInput, TDraft> {
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let handle: unknown = null;
  let held: { input: TInput; draft: TDraft } | null = null;

  const clearTimer = () => {
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
  };

  return {
    start(input, draft) {
      clearTimer();
      held = { input, draft };
      handle = schedule(() => {
        handle = null;
        const h = held;
        held = null;
        if (h) opts.send(h.input);
      }, opts.delayMs);
    },
    undo() {
      clearTimer();
      const draft = held?.draft ?? null;
      held = null;
      return draft;
    },
    abandon() {
      clearTimer();
      const draft = held?.draft ?? null;
      held = null;
      return draft;
    },
    pending() {
      return handle !== null;
    },
  };
}
