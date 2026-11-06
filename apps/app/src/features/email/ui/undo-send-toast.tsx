// The undo-send toast (specs/mail-v3.md §5, AC19) through the app's one undo
// grammar (`lib/undo-toast.tsx`): "Reply to Ana sends in 10 s · thread marked
// Done", with Undo and Edit. The countdown runs to the engine's send time (the
// send handle's `sendAtMs`), never a window the UI made up.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { undoToast } from "@/lib/undo-toast";

import type { ComposeDeps, SentInfo } from "../compose/session";

/** What a send did besides queueing, for the toast's tail. */
export type MailSentInfo = SentInfo;

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });

/** The first recipient's first name: the typed display name, a known name, else the address. */
export function recipientFirstName(
  to: string,
  nameFor: (email: string) => string | null = () => null,
): string {
  const first = to.split(",")[0]?.trim() ?? "";
  const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(first);
  const email = (m ? m[2]! : first).trim();
  const name = (m?.[1]?.trim() || nameFor(email.toLowerCase()) || "").trim();
  if (name) return name.split(/\s+/)[0]!;
  return email || "them";
}

/** "Reply to Ana sends in 10 s · thread marked Done". */
export function undoSendText(info: MailSentInfo, firstName: string, seconds: number): string {
  const who = `${info.kind === "reply" || info.kind === "reply-all" ? "Reply" : "Message"} to ${firstName}`;
  let tail = "";
  if (info.markedDone) tail += " · thread marked Done";
  if (info.followUpMs !== null)
    tail += ` · reminds you ${WEEKDAY.format(new Date(info.followUpMs))}`;
  return `${who} sends in ${Math.max(0, seconds)} s${tail}`;
}

const secondsLeft = (untilMs: number, nowMs: number) => Math.ceil((untilMs - nowMs) / 1000);

function SendCountdown({
  info,
  firstName,
  untilMs,
  now,
}: {
  info: MailSentInfo;
  firstName: string;
  untilMs: number;
  now: () => number;
}) {
  const [left, setLeft] = useState(() => secondsLeft(untilMs, now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(secondsLeft(untilMs, now())), 250);
    return () => clearInterval(t);
  }, [untilMs, now]);
  return <span>{undoSendText(info, firstName, left)}</span>;
}

type ShowSent = NonNullable<ComposeDeps["showSent"]>;

/**
 * The page's undo-send toast: `sent` is the compose session's `showSent`, and
 * `undoFirst` lets the shell's undo key cancel a send still in its window
 * before it undoes triage.
 */
export function useUndoSendToast(opts: {
  now: () => number;
  nameFor: (email: string) => string | null;
}) {
  const sent = useRef<ShowSent | undefined>(undefined);
  const pending = useRef<{ id: string | number; untilMs: number; undo: () => void } | null>(null);
  const live = useRef(opts);
  useEffect(() => {
    live.current = opts;
  });
  useEffect(() => {
    sent.current = (handle, actions, info) => {
      const { now, nameFor } = live.current;
      const settle = (run: () => void) => () => {
        pending.current = null;
        run();
      };
      const id = showUndoSendToast({
        info,
        firstName: recipientFirstName(info.to, nameFor),
        untilMs: handle.sendAtMs,
        now,
        onUndo: settle(actions.undo),
        onEdit: settle(actions.edit),
      });
      pending.current = { id, untilMs: handle.sendAtMs, undo: actions.undo };
    };
  }, []);
  const undoFirst = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (!p || live.current.now() >= p.untilMs) return false;
    toast.dismiss(p.id);
    p.undo();
    return true;
  }, []);
  return { sent, undoFirst };
}

/** Shows the toast; it closes when the engine sends. Returns the toast id. */
export function showUndoSendToast(opts: {
  info: MailSentInfo;
  firstName: string;
  /** The engine's send time (`MailSendHandle.sendAtMs`). */
  untilMs: number;
  now: () => number;
  onUndo: () => void;
  onEdit: () => void;
}): string | number {
  return undoToast(
    <SendCountdown
      info={opts.info}
      firstName={opts.firstName}
      untilMs={opts.untilMs}
      now={opts.now}
    />,
    {
      durationMs: Math.max(0, opts.untilMs - opts.now()),
      onUndo: opts.onUndo,
      link: { label: "Edit", onClick: opts.onEdit },
    },
  );
}
