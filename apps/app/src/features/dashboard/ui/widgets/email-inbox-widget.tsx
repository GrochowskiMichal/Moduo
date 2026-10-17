// DB-5 — "Inbox" widget (ports EM-11 `email/widget.ts`). A glance at the cloud
// tissue: unread per account (desktop-pushed counts), snoozed threads returning
// today, and follow-ups awaiting a reply. Platform-gated to desktop (the widget
// body only mounts where `hasEmail`); `degraded` covers the pre-connect state.

import { Clock3, CornerUpLeft, Mail } from "lucide-react";
import { useMemo } from "react";
import { formatEmailDate } from "@/features/email/utils/email-format";
import {
  type EmailInboxThreadRow,
  type EmailInboxView,
  shapeEmailInbox,
} from "@/features/email/widget";

import { useDashboardData } from "../../context/dashboard-data-context";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity, openModuleRoute } from "../../widget-nav";
import {
  WidgetBodyRoot,
  WidgetEmpty,
  WidgetList,
  WidgetLoading,
  WidgetRow,
  WidgetScroll,
  WidgetSectionLabel,
} from "./widget-primitives";

function ThreadRow({ row, icon }: { row: EmailInboxThreadRow; icon: typeof Clock3 }) {
  return (
    <WidgetRow
      icon={icon}
      title={row.fromName}
      secondary={row.subject}
      trailing={row.when ? formatEmailDate(row.when) : undefined}
      onClick={() => openEntity("email_thread", row.refId)}
    />
  );
}

function Body({ view }: { view: EmailInboxView }) {
  return (
    <WidgetScroll>
      <div className="flex flex-col gap-0.5 p-1.5">
        {view.accounts.length > 0 ? (
          <>
            <WidgetSectionLabel count={view.totalUnread}>Unread</WidgetSectionLabel>
            <WidgetList className="p-0">
              {view.accounts.map((account) => (
                <WidgetRow
                  key={account.id}
                  icon={Mail}
                  title={account.address}
                  trailing={account.unread > 0 ? String(account.unread) : "0"}
                  onClick={() => openModuleRoute("/email")}
                />
              ))}
            </WidgetList>
          </>
        ) : null}

        {view.snoozedDueToday.length > 0 ? (
          <>
            <WidgetSectionLabel count={view.snoozedDueToday.length}>
              Returning today
            </WidgetSectionLabel>
            <WidgetList className="p-0">
              {view.snoozedDueToday.map((row) => (
                <ThreadRow key={row.refId} row={row} icon={Clock3} />
              ))}
            </WidgetList>
          </>
        ) : null}

        {view.awaitingFollowUp.length > 0 ? (
          <>
            <WidgetSectionLabel count={view.awaitingFollowUp.length}>
              Awaiting reply
            </WidgetSectionLabel>
            <WidgetList className="p-0">
              {view.awaitingFollowUp.map((row) => (
                <ThreadRow key={row.refId} row={row} icon={CornerUpLeft} />
              ))}
            </WidgetList>
          </>
        ) : null}
      </div>
    </WidgetScroll>
  );
}

export function EmailInboxWidget({ size }: WidgetComponentProps) {
  const { email } = useDashboardData();
  const density = useDensity();

  const view = useMemo(
    () => shapeEmailInbox(email.data, { now: new Date(), limit: widgetRowBudget(size, density) }),
    [email.data, size, density],
  );

  if (email.loading && view.accounts.length === 0) return <WidgetLoading />;

  const empty =
    view.accounts.length === 0 &&
    view.snoozedDueToday.length === 0 &&
    view.awaitingFollowUp.length === 0;

  if (empty) {
    return (
      <WidgetEmpty>
        {view.degraded
          ? "Connect email on the desktop app to see your inbox here."
          : "Inbox zero — nothing snoozed or awaiting a reply."}
      </WidgetEmpty>
    );
  }

  return (
    <WidgetBodyRoot>
      <Body view={view} />
    </WidgetBodyRoot>
  );
}
