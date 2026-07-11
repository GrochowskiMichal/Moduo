// The app's ONE destructive-feedback grammar (DF-5, critique §8.3): a neutral
// toast + an 8s "Undo" action. Every soft-destructive path (task/contact/
// event delete, note trash, habit remove, email triage) speaks this shape —
// success feedback is the neutral toast() voice, never toast.success, and the
// undo window never drifts from UNDO_TOAST_MS. Hard-destructive actions
// (API-key revoke, company delete) confirm first instead — see the callers.
import { type ReactNode } from "react";
import { toast } from "sonner";

/** The one undo window. Don't inline 8000 — drift is how grammars die. */
export const UNDO_TOAST_MS = 8000;

type UndoToastOptions = {
  description?: ReactNode;
  /** Runs when the user clicks Undo. Do the restore (and your own error toast) here. */
  onUndo: () => void;
  /**
   * An optional destructive escalation ("Delete the tasks too") rendered as a
   * quiet destructive text link in the toast BODY — never in sonner's `cancel`
   * slot, where a destructive verb reads as the dismiss button.
   */
  danger?: { label: string; onClick: () => void };
};

/** Neutral toast + 8s Undo — returns the toast id. */
export function undoToast(label: string, opts: UndoToastOptions): string | number {
  // `toastId` is referenced only inside the danger onClick (which runs at click
  // time, after toast() has returned) — so the const is always initialized by
  // the time the closure reads it.
  const toastId: string | number = toast(label, {
    duration: UNDO_TOAST_MS,
    description: opts.danger ? (
      <span className="flex flex-col items-start gap-1">
        {opts.description ? <span>{opts.description}</span> : null}
        {/* A quiet destructive text link — the design system's `link` button
            role: font-display (R4), rounded-md focus ring (R2), no fill. Kept
            as a raw button (not the Button primitive) so this lib stays free of
            the `@/` component value-import chain vitest can't resolve. */}
        <button
          type="button"
          className="rounded-md font-display text-sm text-destructive underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => {
            toast.dismiss(toastId);
            opts.danger?.onClick();
          }}
        >
          {opts.danger.label}
        </button>
      </span>
    ) : (
      opts.description
    ),
    action: { label: "Undo", onClick: opts.onUndo },
  });
  return toastId;
}
