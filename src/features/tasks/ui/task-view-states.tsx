// The List and Board states besides "tasks" (TV-P0, tasks-v3 AC1.5): a
// skeleton while the first load is out (never "empty" before the answer), "No
// tasks match" when a filter hides everything, and a calm empty scope that
// teaches the one gesture. DS-6 standardises these on the kit's EmptyState.

import { Plus } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";

import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Kbd } from "../../../components/ui/kbd";
import { cn } from "../../../lib/utils";

const BAR = "motion-safe:animate-pulse rounded-sm bg-muted";

/** Title widths for the placeholder rows, so the skeleton reads as a list. */
const ROWS = [
  { key: "r1", width: "w-3/5" },
  { key: "r2", width: "w-2/5" },
  { key: "r3", width: "w-1/2" },
  { key: "r4", width: "w-2/3" },
  { key: "r5", width: "w-1/3" },
  { key: "r6", width: "w-1/2" },
];

/** Board placeholder columns and their cards. */
const COLUMNS = [
  { key: "c1", cards: ROWS.slice(0, 3) },
  { key: "c2", cards: ROWS.slice(3, 5) },
  { key: "c3", cards: ROWS.slice(5, 6) },
];

/** The List's eight placeholder rows (research §9): title bars at 62 / 48 / 71 / 55 %. */
const LIST_ROWS = [
  { key: "l1", width: "w-[62%]" },
  { key: "l2", width: "w-[48%]" },
  { key: "l3", width: "w-[71%]" },
  { key: "l4", width: "w-[55%]" },
  { key: "l5", width: "w-[62%]" },
  { key: "l6", width: "w-[48%]" },
  { key: "l7", width: "w-[71%]" },
  { key: "l8", width: "w-[55%]" },
];

/** How long a load may take before the skeleton shows (research §9). */
export const SKELETON_DELAY_MS = 300;

/**
 * List rows while tasks load (research §9): nothing for 300 ms (the device
 * copy usually answers first), then eight still rows at the density's height,
 * the status icon and a title bar in a decorative fill, no shimmer. Its
 * status is announced at once, so a reader knows it's loading.
 */
export function TaskListSkeleton({ delayMs = SKELETON_DELAY_MS }: { delayMs?: number }) {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const id = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);
  return (
    <div role="status" aria-label="Loading tasks" aria-busy="true" className="flex flex-col pt-1">
      {shown
        ? LIST_ROWS.map(({ key, width }) => (
            <div key={key} className="flex h-(--row-h) items-center gap-3 pr-2.5 pl-2">
              <span className={cn(STILL_BAR, "size-icon-sm shrink-0 rounded-full")} />
              <span className={cn(STILL_BAR, "h-3", width)} />
              <span className={cn(STILL_BAR, "ml-auto h-3 w-10 shrink-0")} />
            </div>
          ))
        : null}
    </div>
  );
}

/** The List's still placeholder fill (no pulse: research §9). */
const STILL_BAR = "rounded-sm bg-muted";

/** Board columns while tasks load: three columns of card outlines. */
export function TaskBoardSkeleton() {
  return (
    <div role="status" aria-label="Loading tasks" aria-busy="true" className="flex gap-3">
      {COLUMNS.map((column) => (
        <div key={column.key} className="flex w-72 shrink-0 flex-col gap-2">
          <span className={cn(BAR, "h-3 w-20")} />
          {column.cards.map(({ key, width }) => (
            <div key={key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <span className={cn(BAR, "h-3", width)} />
              <span className={cn(BAR, "h-2.5 w-16")} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A filter hides every task in the scope: say so, how many it hides (research
 * §9: "214 hidden by 2 filters"), and offer the way out. Never "Nothing here".
 */
export function TasksNoMatch({
  onClearFilters,
  hidden,
  filters,
}: {
  onClearFilters?: () => void;
  /** Tasks of the scope the filters and search hide. */
  hidden?: number;
  /** How many filters (and a search) are on. */
  filters?: number;
}) {
  const description =
    hidden && hidden > 0
      ? `${hidden} hidden by ${filters && filters > 1 ? `${filters} filters` : "the filter"}`
      : undefined;
  return (
    <EmptyState
      title="No tasks match"
      description={description}
      action={
        onClearFilters ? (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

/** A scope with no tasks yet: name it, and teach the fastest way to add one. */
export function TasksEmptyScope({
  scopeTitle,
  canEdit,
  onRequestCapture,
  afterEmpty,
}: {
  scopeTitle: string;
  canEdit: boolean;
  onRequestCapture: () => void;
  /** What follows the empty state (an empty project's "+ Add section"). */
  afterEmpty?: React.ReactNode;
}) {
  if (afterEmpty) {
    return (
      <div className="flex flex-col">
        <TasksEmptyScope
          scopeTitle={scopeTitle}
          canEdit={canEdit}
          onRequestCapture={onRequestCapture}
        />
        {afterEmpty}
      </div>
    );
  }
  return (
    <EmptyState
      title={`No tasks in ${scopeTitle}`}
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={() => onRequestCapture()}>
            <Plus aria-hidden />
            Add a task
          </Button>
        ) : undefined
      }
      hint={
        canEdit ? (
          <>
            or press <Kbd>c</Kbd> to capture
          </>
        ) : undefined
      }
    />
  );
}
