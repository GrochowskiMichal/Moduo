// The mail badge and the new-mail notification gate (AC35).

import { mailViewKey } from "@/lib/runtime.types";
import type { MailCounts, MailThreadRow } from "@/lib/runtime.types.mail-engine";

import type { MailBehavior } from "./behavior";

const PERSONAL_KEY = mailViewKey({ kind: "unified", role: "inbox" }, { kind: "personal" });
const INBOX_KEY = mailViewKey({ kind: "unified", role: "inbox" });

/** The number on the nav tab and the Dock for this setting. */
export function mailBadgeCount(counts: MailCounts | null, behavior: MailBehavior): number {
  if (!counts || behavior.badge === "off") return 0;
  if (behavior.badge === "all") return counts.byViewKey[INBOX_KEY] ?? 0;
  return counts.byViewKey[PERSONAL_KEY] ?? counts.badge;
}

/** New mail is badge-only unless Personal notify or a Priority person allows it. */
export function shouldNotifyNewMail(row: MailThreadRow, behavior: MailBehavior): boolean {
  if (!row.unread || row.muted || row.snoozedUntilMs !== null) return false;
  if (row.priority && behavior.notifyPriority) return true;
  return behavior.notifyPersonal && row.tab === "personal";
}
