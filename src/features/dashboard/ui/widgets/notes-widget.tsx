// DB-5 — "Notes" widget (ports NO-10 `notes/recent.ts`). Recently-touched notes;
// each row opens the note (NO-3 URL selection). A Globe marks a published note.

import { useMemo } from "react";
import { FileText, Globe } from "lucide-react";

import { shapeRecentNotes } from "@/features/notes/recent";

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

export function NotesWidget({ size }: WidgetComponentProps) {
  const { recentNotes } = useDashboardData();
  const density = useDensity();

  const items = useMemo(
    () => shapeRecentNotes(recentNotes.data, { limit: 24, now: new Date() }),
    [recentNotes.data],
  );

  if (recentNotes.loading && items.length === 0) return <WidgetLoading />;
  if (items.length === 0) {
    return <WidgetEmpty>No notes yet. Press ⌘⇧N to capture one.</WidgetEmpty>;
  }

  const budget = widgetRowBudget(size, density);
  const shown = items.slice(0, budget);
  const overflow = items.length - shown.length;

  return (
    <WidgetBodyRoot>
      <WidgetList className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {shown.map((note) => (
          <WidgetRow
            key={note.id}
            icon={FileText}
            title={
              note.isPublished ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <span className="min-w-0 truncate">{note.title}</span>
                  <Globe className="size-icon-xs shrink-0 text-muted-foreground/70" aria-label="Published" />
                </span>
              ) : (
                note.title
              )
            }
            secondary={size === "S" ? undefined : note.snippet}
            trailing={note.touchedLabel}
            onClick={() => openEntity("note", note.id)}
          />
        ))}
      </WidgetList>
      <WidgetMore count={overflow} onClick={() => openModuleRoute("/notes")} />
    </WidgetBodyRoot>
  );
}
