// The right panel's "No date" view beside the Timeline (Tasks v3 TV-TL2,
// REPLAN 70, research §4): the place's open tasks with no date and no work
// session, grouped by project and searchable. Drag one onto a day on the
// canvas to make it due then (the whole canvas takes the drop; only the date
// changes, never the project). A click opens its details. It replaces the old
// bottom tray (48b: no strips at the edges).

import { CalendarOff } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { EmptyState } from "../../../components/ui/empty-state";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import type { Bucket, Task } from "../model";
import { PRIVATE_PROJECT_LABEL } from "../model";
import { DraggableTask } from "./dnd/task-dnd";
import { VirtualStack } from "./virtual-stack";

type Item =
  | { kind: "group"; key: string; label: string; count: number }
  | { kind: "task"; key: string; task: Task };

export function TimelineNoDatePanel({
  tasks,
  projects,
  inboxId,
  canEdit,
  selectedTaskId,
  onOpen,
}: {
  /** The place's undated open tasks (`undatedTasks`). */
  tasks: readonly Task[];
  /** Projects in the sidebar's order. */
  projects: readonly Bucket[];
  inboxId: string | null;
  canEdit: boolean;
  selectedTaskId: string | null;
  onOpen: (taskId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = useMemo<Item[]>(() => {
    const words = query.trim().toLowerCase();
    const shown = words ? tasks.filter((t) => t.title.toLowerCase().includes(words)) : tasks;
    const byProject = new Map<string, Task[]>();
    for (const task of shown) {
      const list = byProject.get(task.bucketId);
      if (list) list.push(task);
      else byProject.set(task.bucketId, [task]);
    }
    // The Inbox first, then the sidebar's order, then anything else.
    const order = [
      ...(inboxId ? [inboxId] : []),
      ...projects.map((p) => p.id).filter((id) => id !== inboxId),
    ];
    const known = new Set(order);
    for (const id of byProject.keys()) if (!known.has(id)) order.push(id);
    const names = new Map(projects.map((p) => [p.id, p.name]));
    const out: Item[] = [];
    for (const id of order) {
      const own = byProject.get(id);
      if (!own?.length) continue;
      const label = id === inboxId ? "Inbox" : (names.get(id) ?? PRIVATE_PROJECT_LABEL);
      out.push({ kind: "group", key: `group:${id}`, label, count: own.length });
      const sorted = [...own].sort((a, b) =>
        a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
      );
      for (const task of sorted) out.push({ kind: "task", key: task.id, task });
    }
    return out;
  }, [tasks, projects, inboxId, query]);

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={CalendarOff}
        title="Everything here has a date"
        description="Tasks with no due date and no work session show up here."
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-timeline-no-date="">
      <Input
        size="sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search the tasks with no date"
      />
      {canEdit ? (
        <p className="font-sans text-xs text-muted-foreground">Drag a task onto a day.</p>
      ) : null}
      <div ref={scrollRef} className="scrollbar-thin -mx-1 min-h-0 flex-1 overflow-auto px-1">
        {items.length === 0 ? (
          <p className="py-2 font-sans text-sm text-muted-foreground">Nothing matches.</p>
        ) : (
          <VirtualStack
            items={items}
            itemKey={(item) => item.key}
            estimateSize={(item) => (item.kind === "group" ? 28 : 32)}
            scrollRef={scrollRef}
            render={(item) =>
              item.kind === "group" ? (
                <div className="flex h-(--row-h-sm) items-center gap-2 pt-1">
                  <span className="min-w-0 truncate font-sans text-xs font-medium text-muted-foreground">
                    {item.label}
                  </span>
                  <span className="font-sans text-xs tabular-nums text-subtle-foreground">
                    {item.count}
                  </span>
                </div>
              ) : (
                <DraggableTask
                  id={item.task.id}
                  from="no-date"
                  disabled={!canEdit}
                  render={({ dragListeners, dragActivatorRef }) => (
                    <button
                      ref={dragActivatorRef}
                      type="button"
                      data-no-date-task={item.task.id}
                      {...dragListeners}
                      onClick={() => onOpen(item.task.id)}
                      className={cn(
                        "flex h-(--row-h) w-full items-center rounded-md px-2 text-left font-sans text-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
                        canEdit && "cursor-grab",
                        selectedTaskId === item.task.id && "bg-state-selected",
                      )}
                    >
                      <span className="min-w-0 truncate">{item.task.title || "Untitled"}</span>
                    </button>
                  )}
                />
              )
            }
          />
        )}
      </div>
    </div>
  );
}
