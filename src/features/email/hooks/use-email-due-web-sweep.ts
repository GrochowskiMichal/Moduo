// DF-21f — email-due WEB parity (Universal Inbox, AC12). A light, app-wide,
// WEB-ONLY sweep that generates the follow-up-due notifications a web user would
// otherwise never see (the full snooze+follow-up loop is desktop-only —
// use-email-snooze-restore.ts, driven from the email page). Runs on mount + window
// focus (the "came due while away" catch-up), NOT a tight interval — quiet-core
// refresh cadence (spec Assumption 9). On desktop this is inert: the email page's
// loop already fires follow-ups (and the snooze IMAP restore), so running here too
// would double up.
//
// SAFETY: follow-up-due ONLY. Snooze-due is excluded on web because firing it
// unsnoozes the cloud ref without the desktop IMAP restore, stranding the mail
// (see due-web-sweep.ts). Web also can't do the reply-clear check (no IMAP), so a
// follow-up whose reply hasn't been desktop-swept may nudge once — the server's
// one-shot `follow_up_notified_at` guard bounds it to a single quiet reminder.

import { useEffect, useRef } from "react";

import { isTauriRuntime } from "../../../lib/runtime";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { selectWebFollowUpDue } from "../due-web-sweep";

type Ctx = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  userId: string | null;
  /** Re-derive the bell feed after firing so the badge/list reflect new rows. */
  refresh: () => Promise<void>;
};

export function useEmailDueWebSweep(ctx: Ctx): void {
  const isDesktop = isTauriRuntime();
  const inFlight = useRef(false);
  // Ref ids attempted this session — the client model has no `follow_up_notified_at`
  // to filter on, so we avoid re-calling the (idempotent) op on every focus.
  const attempted = useRef<Set<string>>(new Set());
  const ctxRef = useRef<Ctx>(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    if (isDesktop) return; // desktop's email-page loop owns generation
    let cancelled = false;

    const tick = async () => {
      if (cancelled || inFlight.current) return;
      const c = ctxRef.current;
      if (!c.runtime || !c.workspaceId || !c.userId) return;
      inFlight.current = true;
      try {
        const fired = await sweepFollowUpsWeb(c, attempted.current);
        if (fired && !cancelled) await c.refresh();
      } catch {
        /* transient (offline / pre-deploy) — retried on the next focus */
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [isDesktop]);
}

async function sweepFollowUpsWeb(ctx: Ctx, attempted: Set<string>): Promise<boolean> {
  const { runtime, workspaceId, userId } = ctx;
  if (!runtime || !workspaceId || !userId) return false;

  const bundle = await runtime.email.listModule(workspaceId);
  if (bundle.degraded) return false; // migration not applied — nothing to sweep

  const due = selectWebFollowUpDue(bundle.refs, { userId, nowMs: Date.now() }).filter(
    (id) => !attempted.has(id),
  );
  let fired = false;
  for (const refId of due) {
    const res = await runtime.email.followUpDue({ workspaceId, refId });
    attempted.add(refId); // resolved (fired OR server no-op) → don't retry this session
    if (res) fired = true; // null ⇒ already notified / cleared server-side
  }
  return fired;
}

/**
 * Mounts the web due-sweep app-wide (in the app chrome). A null render — it only
 * wires context (runtime / workspace / refresh) into the hook. Inert on desktop.
 */
export function EmailDueWebSweep(): null {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, refreshNotifications } = useWorkspace();
  useEmailDueWebSweep({
    runtime,
    workspaceId: selectedWorkspaceId,
    userId,
    refresh: refreshNotifications,
  });
  return null;
}
