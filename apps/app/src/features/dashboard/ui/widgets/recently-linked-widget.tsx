// DB-5 — "Recently linked" widget (ports CT-7 `spine/recent.ts`). The workspace's
// most recent links, each row "<source> → <target> · <kind>"; clicking either
// end deep-links to that entity. Neutral, tokens-only (no per-type hue).

import { ArrowRight } from "lucide-react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { resolveEntityIcon } from "@/features/spine/icon-map";
import type { RecentLinkEndpoint } from "@/features/spine/recent";
import { RELATION_KIND_LABELS } from "@/lib/entity-links";
import { cn } from "@/lib/utils";

import { useDashboardData } from "../../context/dashboard-data-context";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity } from "../../widget-nav";
import {
  WidgetBodyRoot,
  WidgetEmpty,
  WidgetList,
  WidgetLoading,
  WidgetMore,
} from "./widget-primitives";

function Endpoint({ end }: { end: RecentLinkEndpoint }) {
  const Icon = resolveEntityIcon(end.type, end.icon);
  return (
    <button
      type="button"
      disabled={end.tombstoned}
      onClick={() => openEntity(end.type, end.id)}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        end.tombstoned ? "opacity-60" : "hover:underline",
      )}
    >
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-foreground">
        {end.tombstoned ? `Deleted ${end.type}` : end.label}
      </span>
    </button>
  );
}

export function RecentlyLinkedWidget({ size }: WidgetComponentProps) {
  const { recentLinks } = useDashboardData();
  const density = useDensity();

  if (recentLinks.loading && recentLinks.data.length === 0) return <WidgetLoading />;

  const items = recentLinks.data;
  if (items.length === 0) {
    return <WidgetEmpty>Nothing linked yet. Drag, @mention, or /ref to connect.</WidgetEmpty>;
  }

  const budget = widgetRowBudget(size, density);
  const shown = items.slice(0, budget);
  const overflow = items.length - shown.length;

  return (
    <WidgetBodyRoot>
      <WidgetList className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {shown.map((item) => (
          <li
            key={item.id}
            className="flex min-h-[var(--row-h)] items-center gap-1.5 rounded-md px-2 py-1 text-sm"
          >
            <Endpoint end={item.source} />
            <ArrowRight className="size-icon-xs shrink-0 text-muted-foreground/70" aria-hidden />
            <Endpoint end={item.target} />
            <Eyebrow className="ml-auto shrink-0 pl-2" tone="tag">
              {RELATION_KIND_LABELS[item.relationKind] ?? item.relationKind}
            </Eyebrow>
          </li>
        ))}
      </WidgetList>
      <WidgetMore count={overflow} />
    </WidgetBodyRoot>
  );
}
