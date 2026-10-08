// DB-5 — "Needs attention" widget (ports CO-5 `contacts/needs-attention.ts`).
// Quiet contact nudges (overdue follow-up / no recent touch / stale lead). Never
// red, never a guilt wall — a muted icon + reason detail; each row opens the contact.

import type { LucideIcon } from "lucide-react";
import { CalendarClock, Clock, UserMinus } from "lucide-react";

import type { NeedsAttentionItem } from "@/features/contacts/needs-attention";

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

const REASON_ICON: Record<NeedsAttentionItem["reason"], LucideIcon> = {
  "overdue-followup": CalendarClock,
  "no-touch": Clock,
  "stale-lead": UserMinus,
};

export function NeedsAttentionWidget({ size }: WidgetComponentProps) {
  const { needsAttention } = useDashboardData();
  const density = useDensity();

  if (needsAttention.loading && needsAttention.data.length === 0) return <WidgetLoading />;

  const items = needsAttention.data;
  if (items.length === 0) {
    return <WidgetEmpty>Nothing needs attention. You're on top of it.</WidgetEmpty>;
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
            icon={REASON_ICON[item.reason]}
            title={item.name}
            trailing={item.detail}
            onClick={() => openEntity("contact", item.contactId)}
          />
        ))}
      </WidgetList>
      <WidgetMore count={overflow} onClick={() => openModuleRoute("/contacts")} />
    </WidgetBodyRoot>
  );
}
