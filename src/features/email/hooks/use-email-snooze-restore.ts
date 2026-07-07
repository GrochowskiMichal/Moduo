// The snooze/follow-up restore orchestrator (EM-6, AC6/AC7/AC16). A desktop-only
// 60s loop (+ mount + window-focus catch-up, so a snooze that came due while the
// app was closed restores on the next foreground) that drives the three time-based
// transitions the cloud can't run itself (no relay, no pg_cron):
//   • a due snooze → IMAP move back to the inbox (Rust) + unsnooze the ref + write
//     the owner-targeted due activity (→ one grouped notification);
//   • a due follow-up → one-shot due notification;
//   • an awaiting follow-up whose COUNTERPART replied → clear it silently.
// The IMAP side is desktop-only; the notification writes ride the cloud ops.

import { useEffect, useRef } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { followUpClearedByReply } from "../followup";
import { isAwaitingFollowUp, isFollowUpDue, isSnoozeDue } from "../refs";
import type { EmailModuleApi } from "./use-email-module";

/** How often the desktop checks for due snoozes / follow-ups. */
export const SNOOZE_POLL_MS = 60_000;

type Ctx = {
  email: EmailModuleApi;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  isDesktop: boolean;
};

export function useEmailSnoozeRestore({
  email,
  runtime,
  workspaceId,
  isDesktop,
}: Ctx): void {
  const inFlight = useRef(false);
  // Latest values without re-subscribing the interval each render.
  const ctxRef = useRef<Ctx>({ email, runtime, workspaceId, isDesktop });
  ctxRef.current = { email, runtime, workspaceId, isDesktop };

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlight.current) return;
      const ctx = ctxRef.current;
      if (!ctx.runtime || !ctx.workspaceId) return;
      inFlight.current = true;
      try {
        await processDue(ctx);
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const id = setInterval(() => void tick(), SNOOZE_POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [isDesktop]);
}

async function processDue(ctx: Ctx): Promise<void> {
  const { email, runtime, workspaceId } = ctx;
  if (!runtime || !workspaceId) return;

  const now = Date.now();
  const refs = email.tissueRefs;
  const selfAddresses = email.accounts.map((a) => a.email);
  let restoredAny = false;
  let changed = false;

  // 1. Due snoozes → move the mail back (Rust) + unsnooze + notify the owner.
  for (const ref of refs) {
    if (!isSnoozeDue(ref, now)) continue;
    try {
      if (ref.accountId) {
        await runtime.email.snoozeRestore({
          accountId: ref.accountId,
          threadId: ref.threadKey,
        });
      }
      await runtime.email.snoozeDue({ workspaceId, refId: ref.id });
      restoredAny = true;
      changed = true;
    } catch {
      /* transient — retried next tick */
    }
  }

  // 2. Reply-clears FIRST — an awaiting follow-up whose counterpart replied clears
  //    silently (a self-reply from any of your accounts never counts, AC7). Doing
  //    this before the due check means a replied-to thread never fires a spurious
  //    "no reply" reminder (the server guards on the now-cleared row anyway).
  for (const ref of refs) {
    if (!isAwaitingFollowUp(ref) || !ref.accountId) continue;
    try {
      const messages = await email.getThread(ref.accountId, ref.threadKey);
      const armedAtMs = Date.parse(ref.updatedAt);
      const cleared = followUpClearedByReply({
        messages: messages.map((m) => ({
          fromEmail: m.senderEmail,
          timestampMs: Date.parse(m.date) || 0,
        })),
        selfAddresses,
        armedAtMs: Number.isFinite(armedAtMs) ? armedAtMs : null,
      });
      if (cleared) {
        await runtime.email.clearFollowUp({ workspaceId, refId: ref.id });
        changed = true;
      }
    } catch {
      /* transient */
    }
  }

  // 3. Due follow-ups → one-shot due notification (server guards re-notification
  //    and skips any the step above just cleared).
  for (const ref of refs) {
    if (!isFollowUpDue(ref, now)) continue;
    try {
      const res = await runtime.email.followUpDue({ workspaceId, refId: ref.id });
      if (res) changed = true;
    } catch {
      /* transient */
    }
  }

  // A restore pulls mail back into INBOX server-side → a sync re-lists it; a pure
  // follow-up/clear change only needs the lighter tissue refresh.
  if (restoredAny) await email.syncNow();
  else if (changed) await email.refreshTissue();
}
