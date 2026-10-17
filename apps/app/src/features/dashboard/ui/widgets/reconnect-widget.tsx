// DB-5 — "Reconnect" widget (ports CO-2 `contacts/reconnect.ts`). A gentle nudge
// to reach out to people you haven't touched in a while — clock icon + muted
// "N days ago"; each row opens the contact. Never a guilt wall.

import { Clock } from "lucide-react";

import type { ReconnectItem } from "@/features/contacts/reconnect";

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
  WidgetMore,
  WidgetRow,
} from "./widget-primitives";

function lastTouchLabel(item: ReconnectItem): string {
  if (item.daysSince == null) return "no recent contact";
  if (item.daysSince < 1) return "today";
  if (item.daysSince === 1) return "1 day ago";
  return `${item.daysSince} days ago`;
}

export function ReconnectWidget({ size }: WidgetComponentProps) {
  const { reconnect } = useDashboardData();
  const density = useDensity();

  if (reconnect.loading && reconnect.data.length === 0) return <WidgetLoading />;

  const items = reconnect.data;
  if (items.length === 0) {
    return <WidgetEmpty>You're in touch with everyone. Nice.</WidgetEmpty>;
  }

  const budget = widgetRowBudget(size, density);
  const shown = items.slice(0, budget);
  const overflow = items.length - shown.length;

  return (
    <WidgetBodyRoot>
      <WidgetList className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {shown.map((item) => (
          <WidgetRow
            key={item.contactId}
            icon={Clock}
            title={item.name}
            trailing={lastTouchLabel(item)}
            onClick={() => openEntity("contact", item.contactId)}
          />
        ))}
      </WidgetList>
      <WidgetMore count={overflow} onClick={() => openModuleRoute("/contacts")} />
    </WidgetBodyRoot>
  );
}
