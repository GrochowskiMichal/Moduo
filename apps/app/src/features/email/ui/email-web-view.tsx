// The /email page on web (AC15): no desktop engine, so a calm note plus the
// tissue — snoozed, follow-ups and recently linked threads — read-only. Carries
// the ref + thread ids so a `?thread=` deep link can scroll to a card (DF-2).

import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "../../../components/ui/empty-state";
import { Eyebrow } from "../../../components/ui/eyebrow";
import type { EmailThreadRef } from "../../../lib/runtime.types";
import type { useEmailModule } from "../hooks/use-email-module";
import { formatSnoozeUntil } from "../snooze";
import { formatEmailDate } from "../utils/email-format";

/** One tissue email card for the web read-only view (AC15). Carries the ref +
 * thread ids so a `?thread=` deep link can scroll to it (DF-2). */
function WebTissueCard({
  thread,
  meta,
  highlighted = false,
}: {
  thread: EmailThreadRef;
  meta?: string | null;
  highlighted?: boolean;
}) {
  return (
    <div
      data-thread-ref-id={thread.id}
      data-thread-key={thread.threadKey}
      className={
        "rounded-lg border bg-card p-3 transition-colors duration-(--motion-fade) ease-(--ease-out) " +
        (highlighted ? "border-ring ring-2 ring-ring" : "border-border")
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {thread.fromName?.trim() || thread.fromAddr || "Unknown sender"}
        </span>
        {thread.sentAt ? (
          <time
            className="shrink-0 text-2xs tabular-nums text-muted-foreground"
            dateTime={thread.sentAt}
          >
            {formatEmailDate(thread.sentAt)}
          </time>
        ) : null}
      </div>
      <div className="truncate text-sm text-foreground">{thread.subject || "(No subject)"}</div>
      {thread.snippet ? (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{thread.snippet}</p>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">{meta ?? ""}</span>
        <span className="text-2xs text-muted-foreground/70">Continue on desktop</span>
      </div>
    </div>
  );
}

function WebTissueSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow as="div">{label}</Eyebrow>
      {children}
    </div>
  );
}

type Props = {
  email: Pick<ReturnType<typeof useEmailModule>, "snoozed" | "followUps" | "tissueRefs">;
  highlightedRefId: string | null;
};

export function EmailWebView({ email, highlightedRefId }: Props) {
  const now = new Date();
  // Recently pulled-into-tissue threads, newest first, minus those already shown
  // under Snoozed / Follow-ups so a thread appears once.
  const shownIds = new Set([
    ...email.snoozed.map((r) => r.id),
    ...email.followUps.map((r) => r.id),
  ]);
  const recentLinked = [...email.tissueRefs]
    .filter((r) => !shownIds.has(r.id))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
    .slice(0, 12);
  const hasAny = email.snoozed.length > 0 || email.followUps.length > 0 || recentLinked.length > 0;
  return (
    <div className="pane-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Mail className="size-icon-sm text-muted-foreground" aria-hidden />
          Open Moduo on desktop to use email
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Your mailbox lives on the desktop app. Snoozed, follow-ups, and linked emails show here.
        </p>
      </div>

      {email.snoozed.length > 0 ? (
        <WebTissueSection label="Snoozed">
          {email.snoozed.map((ref) => (
            <WebTissueCard
              key={ref.id}
              thread={ref}
              highlighted={highlightedRefId === ref.id}
              meta={ref.snoozeUntil ? `Returns ${formatSnoozeUntil(ref.snoozeUntil, now)}` : null}
            />
          ))}
        </WebTissueSection>
      ) : null}

      {email.followUps.length > 0 ? (
        <WebTissueSection label="Follow-ups due">
          {email.followUps.map((ref) => (
            <WebTissueCard
              key={ref.id}
              thread={ref}
              highlighted={highlightedRefId === ref.id}
              meta={ref.followUpAt ? `Reply by ${formatEmailDate(ref.followUpAt)}` : null}
            />
          ))}
        </WebTissueSection>
      ) : null}

      {recentLinked.length > 0 ? (
        <WebTissueSection label="Recently linked">
          {recentLinked.map((ref) => (
            <WebTissueCard key={ref.id} thread={ref} highlighted={highlightedRefId === ref.id} />
          ))}
        </WebTissueSection>
      ) : null}

      {!hasAny ? (
        <EmptyState
          icon={Mail}
          title="Nothing linked yet"
          description="Emails you convert, link, snooze, or follow up on desktop appear here."
        />
      ) : null}
    </div>
  );
}
