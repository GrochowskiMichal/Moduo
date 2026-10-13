// The full-page task (Tasks v3 call 32, research views-board-detail §10): the
// task fills the centre on the same route. A centre header "← Board · Acme
// rebrand" with "3 of 18" and ↑ ↓ for the previous and next task, then the
// details at page width (properties on the right once there's room; the
// description never folds). Back: "←", ⤡, Esc when you're not typing, or
// ⌘[. The right panel shows Project meanwhile (default p).

import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/** An open dialog, menu or popover takes Esc first. */
function overlayOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]',
    ) !== null
  );
}

export function TaskFullPage({
  backLabel,
  position,
  onPrev,
  onNext,
  onClose,
  children,
}: {
  /** Where "←" goes back to: "List · Acme rebrand". */
  backLabel: string;
  /** "3 of 18" in the view's order, when the task is in it. */
  position: { index: number; total: number } | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  /** The task's details, `layout="page"`. */
  children: ReactNode;
}) {
  const latest = useRef({ onPrev, onNext, onClose });
  useLayoutEffect(() => {
    latest.current = { onPrev, onNext, onClose };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditable(event.target) || overlayOpen()) return;
      const { onPrev: prev, onNext: next, onClose: close } = latest.current;
      if (event.key === "Escape" || (event.key === "[" && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        close();
      } else if ((event.key === "ArrowUp" || event.key === "k") && !event.metaKey && prev) {
        event.preventDefault();
        prev();
      } else if ((event.key === "ArrowDown" || event.key === "j") && !event.metaKey && next) {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section
      aria-label="Task"
      data-slot="task-full-page"
      className="motion-view mx-auto flex h-full min-h-0 w-full max-w-280 flex-col gap-2 px-4 pt-2"
    >
      <div className="flex min-h-(--ctrl-h) shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onClose} className="-ml-2 min-w-0">
          <ArrowLeft aria-hidden />
          <span className="min-w-0 break-words text-left">{backLabel}</span>
        </Button>
        <span className="flex-1" />
        {position ? (
          <span className="font-sans text-xs text-muted-foreground tabular-nums">
            {position.index + 1} of {position.total}
          </span>
        ) : null}
        <IconButton
          icon={ChevronUp}
          label="Previous task"
          disabled={!onPrev}
          onClick={() => onPrev?.()}
        />
        <IconButton
          icon={ChevronDown}
          label="Next task"
          disabled={!onNext}
          onClick={() => onNext?.()}
        />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
