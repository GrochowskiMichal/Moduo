// The app's ONE destructive-feedback grammar (DF-5, critique §8.3): a neutral
// toast + an 8s "Undo" action. Every soft-destructive path (task/contact/
// event delete, note trash, habit remove, email triage) speaks this shape —
// success feedback is the neutral toast() voice, never toast.success, and the
// undo window never drifts from UNDO_TOAST_MS. Hard-destructive actions
// (API-key revoke, company delete) confirm first instead — see the callers.
import type { ReactNode } from "react";
import { toast } from "sonner";

/** A key cap inside a toast button (the Kbd primitive's look; this lib stays free of
 *  `@/` component imports). */
const KEY_CAP =
  "rounded border border-border bg-muted px-1 py-0.5 font-mono text-2xs text-muted-foreground";

/** A body button with its key, styled like sonner's Undo (Mail's "Also mark the email Done"). */
const KEYED_BUTTON =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-display text-sm text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring";

/** The one undo window. Don't inline 8000 — drift is how grammars die. */
export const UNDO_TOAST_MS = 8000;

type UndoToastOptions = {
  description?: ReactNode;
  /** Runs when the user clicks Undo. Do the restore (and your own error toast) here. */
  onUndo: () => void;
  /**
   * Runs once if the toast closes WITHOUT Undo: it timed out (sonner holds the
   * clock while the toasts are hovered or the window is hidden) or was swiped
   * or dismissed away. The seam for a deferred commit — hold the server write
   * until Undo is off screen, so Undo never races a write that already landed.
   * The `danger` escalation dismisses the toast, so it commits too — after the
   * escalation runs (sonner applies a dismiss on its next render).
   */
  onCommit?: () => void;
  /**
   * An optional destructive escalation ("Delete the tasks too") rendered as a
   * quiet destructive text link in the toast BODY — never in sonner's `cancel`
   * slot, where a destructive verb reads as the dismiss button.
   */
  danger?: { label: string; onClick: () => void };
  /**
   * An optional way to where the item went ("Recently deleted", REPLAN 98),
   * rendered as a quiet text link in the toast BODY; clicking it closes the
   * toast without undoing (a deferred commit then commits).
   */
  link?: {
    label: string;
    onClick: () => void;
    /** Its key, shown as a key cap after the label and named in `aria-keyshortcuts`
     *  (Mail's "Also mark the email Done  e"); styled like the Undo button then. */
    keyHint?: string;
  };
  /** Undo's key, shown as a key cap after "Undo" (Mail's ⌘Z, specs/mail-improve.md §3). */
  undoKey?: string;
  /** A stable id: the next toast with it replaces this one instead of stacking
   *  (Mail's triage: one toast, the latest action's). */
  id?: string;
  /**
   * Only for a window another clock owns (Mail's undo send, whose end the
   * engine reports): the toast stays exactly that long. Everything else keeps
   * UNDO_TOAST_MS.
   */
  durationMs?: number;
};

/** Neutral toast + 8s Undo — returns the toast id. */
export function undoToast(label: ReactNode, opts: UndoToastOptions): string | number {
  // With `onCommit`, the toast settles exactly once: Undo, or closing → commit.
  let settled = false;
  const settle = (run: () => void) => () => {
    if (settled) return;
    settled = true;
    run();
  };
  const commit = opts.onCommit ? settle(opts.onCommit) : undefined;
  // `toastId` is referenced only inside the danger onClick (which runs at click
  // time, after toast() has returned) — so the const is always initialized by
  // the time the closure reads it.
  const extra = opts.danger ?? opts.link;
  const toastId: string | number = toast(label, {
    ...(opts.id ? { id: opts.id } : {}),
    duration: opts.durationMs ?? UNDO_TOAST_MS,
    description: extra ? (
      <span className="flex flex-col items-start gap-1">
        {opts.description ? <span>{opts.description}</span> : null}
        {/* A quiet destructive text link — the design system's `link` button
            role: font-display (R4), rounded-md focus ring (R2), no fill. Kept
            as a raw button (not the Button primitive) so this lib stays free of
            the `@/` component value-import chain vitest can't resolve. */}
        <button
          type="button"
          aria-keyshortcuts={opts.link?.keyHint}
          className={
            opts.danger
              ? "rounded-md font-display text-sm text-destructive underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              : opts.link?.keyHint
                ? KEYED_BUTTON
                : "rounded-md font-display text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          }
          onClick={() => {
            toast.dismiss(toastId);
            extra.onClick();
          }}
        >
          {extra.label}
          {opts.link?.keyHint ? <kbd className={KEY_CAP}>{opts.link.keyHint}</kbd> : null}
        </button>
      </span>
    ) : (
      opts.description
    ),
    action: {
      label: opts.undoKey ? (
        <span className="flex items-center gap-1">
          Undo
          <kbd className={KEY_CAP}>{opts.undoKey}</kbd>
        </span>
      ) : (
        "Undo"
      ),
      onClick: commit ? settle(opts.onUndo) : opts.onUndo,
    },
    ...(commit ? { onAutoClose: commit, onDismiss: commit } : {}),
  });
  return toastId;
}
