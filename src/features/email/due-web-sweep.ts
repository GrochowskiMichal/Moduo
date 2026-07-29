// DF-21f — email-due WEB parity (Universal Inbox, AC12). The desktop runs a full
// snooze/follow-up restore loop (use-email-snooze-restore.ts); web has no IMAP, so
// a web user never generates the due activity rows the bell reads. This is the
// safe, cloud-only half: pick the follow-ups a WEB sweep should fire.
//
// Follow-up-due ONLY — snooze-due is deliberately excluded on web. `email_op_snooze_due`
// UNSNOOZES the cloud ref (is_snoozed→false); on desktop that's paired with the IMAP
// move back to the inbox. Firing it from web (no IMAP) would clear is_snoozed so the
// desktop's `isSnoozeDue` never fires → the mail is stranded in Moduo/Snoozed. A
// follow-up-due has no IMAP side effect (it only writes a one-shot notification), so
// it is safe to generate anywhere. See use-email-due-web-sweep.ts.

import { isFollowUpDue } from "./refs";
import type { EmailThreadRef } from "@/lib/runtime.types";

/**
 * The ref ids a web sweep should call `email_op_follow_up_due` for: MY awaiting
 * follow-ups whose deadline has passed. Scoped to the current user's own refs
 * (email is personal at alpha) so a sweep never fires a due reminder attributed to
 * someone else. The server op is one-shot (guards on `follow_up_notified_at`) and
 * re-checks `follow_up_cleared_at`, so a redundant call is a cheap no-op — but web
 * can't run the desktop's reply-clear (no IMAP `getThread`), so a follow-up whose
 * reply hasn't been desktop-swept yet may still nudge once (a quiet false-positive,
 * bounded to one notification; the desktop clears it on its next run).
 */
export function selectWebFollowUpDue(
  refs: EmailThreadRef[],
  opts: { userId: string | null; nowMs: number },
): string[] {
  if (!opts.userId) return [];
  return refs
    .filter((ref) => ref.ownerId === opts.userId && isFollowUpDue(ref, opts.nowMs))
    .map((ref) => ref.id);
}
