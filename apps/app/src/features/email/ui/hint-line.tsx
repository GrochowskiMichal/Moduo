// The persistent hint line at the foot of the list (specs/mail-v3.md §5,
// AC19): at rest the next useful key for the place, after a key the result for
// 4 s ("Done, in Archive · ⌘Z undoes"), after a pointer action "Next time press
// e" for 4 s. It follows the Settings "Show key hints" toggle.

import type { MailOpKind } from "@contracts/mail";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Kbd } from "@/components/ui/kbd";
import type { MailOpInput, MailView } from "@/lib/runtime.types.mail-engine";

import { opLabel } from "./system-copy";

/** How long a result or a key tip stays before the line returns to rest. */
export const HINT_MS = 4000;

export type MailHint = { kind: "result"; text: string } | { kind: "teach"; key: string };

/** The next useful key for a place, or null when the list is empty. */
export function restHint(view: MailView, hasRows: boolean): string | null {
  if (!hasRows) return null;
  if (view.kind === "outbox") return "↵ Edit · sends on its own when online";
  if (view.kind === "new_senders") return "j k to move · Allow or Block · ? all keys";
  if (view.kind === "unified") {
    if (view.role === "archive") return "j k to move · ⇧e Not done · ? all keys";
    if (view.role === "drafts") return "j k to move · ↵ Edit · # Delete · ? all keys";
    if (view.role === "sent") return "j k to move · w Remind me if no reply · ? all keys";
  }
  return "e Done · s Snooze · t Task";
}

const RESULT: Partial<Record<MailOpKind, string>> = {
  done: "Done, in Archive",
  undone: "Not done, back in Inbox",
  delete: "Deleted, in Trash",
  restore: "Restored",
  move: "Moved",
  spam: "Reported spam, in Spam",
  not_spam: "Not spam, back in Inbox",
  pin: "Pinned",
  unpin: "Unpinned",
  mark_read: "Marked read",
  mark_unread: "Marked unread",
  mute: "Muted",
  unmute: "Unmuted",
  block_sender: "Blocked",
};

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

/** "Mon 9:00", local time. */
export function formatReturn(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAY.format(d)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** What a key did: "Done, in Archive · ⌘Z undoes". */
export function resultHint(
  kind: MailOpKind,
  args: MailOpInput["args"] | undefined,
  isMac: boolean,
): string {
  const until = (args as { untilMs?: number } | undefined)?.untilMs;
  const what =
    kind === "snooze" && typeof until === "number"
      ? `Snoozed until ${formatReturn(until)}`
      : (RESULT[kind] ?? opLabel(kind));
  return `${what} · ${isMac ? "⌘Z" : "Ctrl+Z"} undoes`;
}

/** The line's state: a result or a key tip that fades back to rest after 4 s. */
export function useMailHint(isMac: boolean) {
  const [hint, setHint] = useState<MailHint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: MailHint) => {
    if (timer.current) clearTimeout(timer.current);
    setHint(next);
    timer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /** After a key: what it did. */
  const result = useCallback(
    (kind: MailOpKind, args?: MailOpInput["args"]) =>
      show({ kind: "result", text: resultHint(kind, args, isMac) }),
    [show, isMac],
  );
  /** After a pointer action: the key that does it. */
  const teach = useCallback((key: string) => show({ kind: "teach", key }), [show]);
  return { hint, result, teach };
}

export function MailHintLine({
  enabled,
  rest,
  hint,
}: {
  /** Settings → Mail "Show key hints". */
  enabled: boolean;
  rest: string | null;
  hint: MailHint | null;
}) {
  if (!enabled) return null;
  let body: ReactNode = rest ? <span className="text-subtle-foreground">{rest}</span> : null;
  if (hint?.kind === "result") body = hint.text;
  if (hint?.kind === "teach")
    body = (
      <>
        Next time press <Kbd>{hint.key}</Kbd>
      </>
    );
  return (
    <div
      data-slot="mail-hint-line"
      aria-live="polite"
      className="flex min-h-(--row-h-sm) shrink-0 items-center gap-1 border-t border-hairline px-3 text-xs text-muted-foreground"
    >
      {body}
    </div>
  );
}
