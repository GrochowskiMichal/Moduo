// The List and Board states besides "tasks" (TV-P0, tasks-v3 AC1.5): a
// skeleton while the first load is out (never "empty" before the answer), "No
// tasks match" when a filter hides everything, and a calm empty scope that
// teaches the one gesture. DS-6 standardises these on the kit's EmptyState.

import { Plus } from "lucide-react";

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

/** List rows while tasks load: the row's checkbox, title and date in outline. */
export function TaskListSkeleton() {
  return (
    <div role="status" aria-label="Loading tasks" aria-busy="true" className="flex flex-col">
      {ROWS.map(({ key, width }) => (
        <div key={key} className="flex h-(--row-h) items-center gap-2.5 px-2">
          <span className={cn(BAR, "size-icon-sm shrink-0 rounded-full")} />
          <span className={cn(BAR, "h-3", width)} />
          <span className={cn(BAR, "ml-auto h-3 w-10 shrink-0")} />
        </div>
      ))}
    </div>
  );
}

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

/** A filter hides every task in the scope: say so, and offer the way out. */
export function TasksNoMatch({ onClearFilters }: { onClearFilters?: () => void }) {
  return (
    <EmptyState
      title="No tasks match"
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
}: {
  scopeTitle: string;
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  return (
    <EmptyState
      title={`No tasks in ${scopeTitle}`}
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={onRequestCapture}>
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
