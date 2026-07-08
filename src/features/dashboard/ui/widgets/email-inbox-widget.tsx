// "Inbox & follow-ups" dashboard widget (EM-11, AC18 — the Email module DoD widget).
//
// A glance at the cloud tissue: unread per account (desktop-pushed counts),
// snoozed threads returning today, and follow-ups awaiting a reply. Rows deep-link
// via `moduo:entity:open` (the app chrome routes email_thread → /email). Tokens-
// only; degrades to a quiet state on any read error or pre-migration (a widget
// must never wall). The full mailbox lives on desktop — this is the spine view.

import { useEffect, useState, type ReactNode } from "react";
import { Clock3, CornerUpLeft, Mail } from "lucide-react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  shapeEmailInbox,
  type EmailInboxThreadRow,
  type EmailInboxView,
} from "@/features/email/widget";
import { formatEmailDate } from "@/features/email/utils/email-format";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

const EMPTY: EmailInboxView = {
  accounts: [],
  totalUnread: 0,
  snoozedDueToday: [],
  awaitingFollowUp: [],
  degraded: false,
};

/** Open the email module (the thread ref rides the entity-open contract). */
function openThread(refId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("moduo:entity:open", { detail: { type: "email_thread", id: refId } }),
  );
}

function openEmail() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: "email", id: "" } }));
}

function ThreadRow({ row, icon: Icon }: { row: EmailInboxThreadRow; icon: typeof Clock3 }) {
  return (
    <button
      type="button"
      onClick={() => openThread(row.refId)}
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="mt-0.5 size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-sm text-foreground">{row.fromName}</span>
        <span className="truncate text-xs text-muted-foreground">{row.subject}</span>
      </span>
      {row.when ? (
        <time className="shrink-0 pl-2 pt-0.5 text-2xs tabular-nums text-muted-foreground/70">
          {formatEmailDate(row.when)}
        </time>
      ) : null}
    </button>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 px-2 pb-0.5 pt-2">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-2xs tabular-nums text-muted-foreground/70">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Body({ view }: { view: EmailInboxView }) {
  return (
    <div className="flex flex-col gap-0.5 p-2">
      {view.accounts.length > 0 ? (
        <Section label="Unread" count={view.totalUnread}>
          {view.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={openEmail}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Mail className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{account.address}</span>
              <span
                className={
                  "shrink-0 text-sm tabular-nums " +
                  (account.unread > 0 ? "font-medium text-foreground" : "text-muted-foreground/60")
                }
              >
                {account.unread}
              </span>
            </button>
          ))}
        </Section>
      ) : null}

      {view.snoozedDueToday.length > 0 ? (
        <Section label="Returning today" count={view.snoozedDueToday.length}>
          {view.snoozedDueToday.map((row) => (
            <ThreadRow key={row.refId} row={row} icon={Clock3} />
          ))}
        </Section>
      ) : null}

      {view.awaitingFollowUp.length > 0 ? (
        <Section label="Awaiting reply" count={view.awaitingFollowUp.length}>
          {view.awaitingFollowUp.map((row) => (
            <ThreadRow key={row.refId} row={row} icon={CornerUpLeft} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function EmailInboxWidget({ runtime, workspaceId, config }: Props) {
  const [view, setView] = useState<EmailInboxView>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const bundle = await runtime.email.listModule(workspaceId);
        if (active) setView(shapeEmailInbox(bundle, { now: new Date(), limit: 4 }));
      } catch {
        // A widget must never wall — degrade to the quiet empty state.
        if (active) setView(EMPTY);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId]);

  const empty =
    view.accounts.length === 0 &&
    view.snoozedDueToday.length === 0 &&
    view.awaitingFollowUp.length === 0;

  return (
    <WidgetShell config={config} title="Inbox & follow-ups" className="flex h-full flex-col bg-card">
      <div className="h-full overflow-y-auto">
        {loading ? (
          <div className="grid h-full place-items-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : empty ? (
          <div className="grid h-full place-items-center px-4 text-center">
            <p className="text-sm text-muted-foreground">
              {view.degraded
                ? "Connect email on the desktop app to see your inbox here."
                : "Inbox zero — nothing snoozed or awaiting a reply."}
            </p>
          </div>
        ) : (
          <Body view={view} />
        )}
      </div>
    </WidgetShell>
  );
}
