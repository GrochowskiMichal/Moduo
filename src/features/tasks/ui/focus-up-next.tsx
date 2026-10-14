// Up next on the Focus screen (TV-F7, spec §7; REPLAN 62): the rest of my
// line-up in order, numbered, with a divider where the project changes,
// "Up next · 4 · ~1h" above. Drag or ⌥⇧↑↓ reorders (with Undo); a row opens
// its details on click; hover offers ▶ Focus on this and Remove. TV-F8 adds
// your usual pace to the header (10), "Arrange by project · 2 fewer switches"
// when it saves two or more (57, 62), and the next meeting as a divider where
// it falls (64).

import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CalendarClock, Paperclip, Play, X } from "lucide-react";
import { useCallback, useMemo } from "react";

import { IconButton } from "../../../components/ui/icon-button";
import { Kbd } from "../../../components/ui/kbd";
import { MetaCount } from "../../../components/ui/meta-count";
import { NavRowDot } from "../../../components/ui/nav-row";
import { SELECTED_ROW } from "../../../components/ui/selection";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { formatDuration, formatTime } from "../../../lib/time-format";
import { undoToast } from "../../../lib/undo-toast";
import { cn } from "../../../lib/utils";
import { filesLabel } from "../../attachments/files";
import { TaskClaimMark } from "../../focus/ui/claim-mark";
import { type MeetingLine, upNextLines, upNextMove, upNextSummary } from "../focus-screen";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { estimateOf, type Task } from "../model";
import { bucketDotColor } from "../sidebar";
import {
  DndBoundary,
  type DragActivatorRef,
  SortableTask,
  useTaskDndSensors,
} from "./dnd/task-dnd";

// ── Up next ─────────────────────────────────────────────────────────────────

export function UpNext({
  upNext,
  api,
  canEdit,
  bucketNameById,
  selectedTaskId,
  onSelectTask,
  dndMode,
  meeting = null,
  pace = null,
  arrange = null,
}: {
  upNext: Task[];
  api: TasksModuleApi;
  canEdit: boolean;
  bucketNameById: (id: string) => string;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  dndMode: "internal" | "external";
  /** The next meeting's divider and where it falls (64). */
  meeting?: MeetingLine | null;
  /** "≈ 1h 20m at your usual pace" (10), or null. */
  pace?: string | null;
  /** "Arrange by project · n fewer switches", when it saves two or more (62). */
  arrange?: { saved: number; onArrange: () => void } | null;
}) {
  const sensors = useTaskDndSensors();
  const ids = useMemo(() => upNext.map((t) => t.id), [upNext]);
  const lines = useMemo(() => upNextLines(upNext, meeting), [upNext, meeting]);
  const projects = useMemo(() => new Map(api.buckets.map((b) => [b.id, b])), [api.buckets]);
  // A lined-up subtask says whose it is ("· ↳ parent").
  const parentTitles = useMemo(() => {
    const wanted = new Set(upNext.map((t) => t.parentId).filter(Boolean));
    const map = new Map<string, string>();
    if (wanted.size === 0) return map;
    for (const t of api.tasks) if (wanted.has(t.id)) map.set(t.id, t.title || "Untitled");
    return map;
  }, [upNext, api.tasks]);

  // A move inside Up next as the whole line-up's order: Now and everything
  // else keep their places (`upNextMove`); Undo puts the line-up back.
  const reorder = useCallback(
    (taskId: string, to: number, label: string) => {
      const before = api.queuedTasks.map((t) => t.id);
      const after = upNextMove(before, ids, taskId, to);
      if (!after) return;
      api.reorderQueue(after, () => undoToast(label, { onUndo: () => api.reorderQueue(before) }));
    },
    [api, ids],
  );
  const move = (id: string, delta: 1 | -1) => {
    const from = ids.indexOf(id);
    if (from < 0) return;
    reorder(id, from + delta, delta < 0 ? "Moved up" : "Moved down");
  };

  if (upNext.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="px-1 font-sans text-sm text-muted-foreground">
          Last one. Nothing else is lined up.
        </p>
        {meeting ? <MeetingDivider title={meeting.title} startsAt={meeting.startsAt} /> : null}
      </div>
    );
  }

  return (
    <section aria-label="Up next" className="flex flex-col gap-1" data-slot="focus-up-next">
      <div className="flex min-h-(--ctrl-h-sm) flex-wrap items-center gap-x-2 gap-y-0.5 px-1">
        <p className="min-w-0 flex-1 font-sans text-sm text-foreground">
          Up next{" "}
          <span className="tabular-nums text-muted-foreground">{upNextSummary(upNext)}</span>
          {pace ? (
            <span className="tabular-nums text-muted-foreground" data-slot="focus-pace">
              {" "}
              · {pace}
            </span>
          ) : null}
        </p>
        {arrange && canEdit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={arrange.onArrange}
                data-slot="focus-arrange"
                className="hit-min -mr-1 shrink-0 rounded-md px-1.5 font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Arrange by project
                <span className="text-subtle-foreground"> · {arrange.saved} fewer switches</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Keeps each project’s tasks together. Undo any time.</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <DndBoundary
        dndMode={dndMode}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => {
          const { active, over } = e;
          if (!over || active.id === over.id) return;
          const to = ids.indexOf(String(over.id));
          if (to < 0) return;
          reorder(String(active.id), to, "Moved");
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {/* Rows, not a list: each sortable wrapper sits between them and the
              container, and the numbers already say the order. */}
          <div className="flex flex-col">
            {lines.map((line) =>
              line.kind === "meeting" ? (
                <MeetingDivider key={line.key} title={line.title} startsAt={line.startsAt} />
              ) : line.kind === "divider" ? (
                <div
                  key={line.key}
                  className="flex items-center gap-2 px-1.5 pt-2 pb-0.5 font-sans text-xs text-muted-foreground"
                >
                  <NavRowDot
                    color={bucketDotColor(projects.get(line.projectId) ?? {})}
                    className="size-1.5"
                  />
                  <span className="shrink-0">{bucketNameById(line.projectId)}</span>
                  <span aria-hidden className="h-px flex-1 bg-hairline" />
                </div>
              ) : (
                <SortableTask
                  key={line.key}
                  id={line.task.id}
                  from="queue"
                  disabled={!canEdit}
                  render={({ dragListeners, dragActivatorRef }) => (
                    <UpNextRow
                      task={line.task}
                      number={line.number}
                      parentTitle={
                        line.task.parentId ? (parentTitles.get(line.task.parentId) ?? null) : null
                      }
                      selected={selectedTaskId === line.task.id}
                      canEdit={canEdit}
                      files={api.attachmentCounts?.get(line.task.id) ?? 0}
                      onSelect={() => onSelectTask(line.task.id)}
                      onFocusOn={() => api.focusOnTask(line.task.id)}
                      onRemove={() => {
                        const id = line.task.id;
                        api.removeFromQueue(id);
                        undoToast("Removed from Focus", { onUndo: () => api.addToQueue(id) });
                      }}
                      onMove={(delta) => move(line.task.id, delta)}
                      dragListeners={dragListeners}
                      dragActivatorRef={dragActivatorRef}
                    />
                  )}
                />
              ),
            )}
          </div>
        </SortableContext>
      </DndBoundary>
    </section>
  );
}

/** "── 2:30 PM · Acme call ──": your next meeting, where it falls (64). */
function MeetingDivider({ title, startsAt }: { title: string; startsAt: number }) {
  const time = formatTime(startsAt);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          // A row of its own, read out where it sits in the line-up.
          role="note"
          aria-label={`Meeting at ${time}: ${title}. Tasks above the line fit before it.`}
          data-slot="focus-meeting"
          tabIndex={-1}
          className="flex min-h-(--ctrl-h-sm) items-center gap-2 px-1.5 font-sans text-xs text-muted-foreground"
        >
          <span aria-hidden className="h-px flex-1 bg-hairline" />
          <CalendarClock className="size-icon-xs shrink-0 text-subtle-foreground" aria-hidden />
          <span className="shrink-0 tabular-nums">{time}</span>
          <span aria-hidden className="text-subtle-foreground">
            ·
          </span>
          <span className="min-w-0 truncate">{title}</span>
          <span aria-hidden className="h-px flex-1 bg-hairline" />
        </div>
      </TooltipTrigger>
      <TooltipContent>Tasks above the line fit before it, using your estimates</TooltipContent>
    </Tooltip>
  );
}

function UpNextRow({
  task,
  number,
  parentTitle,
  selected,
  canEdit,
  files,
  onSelect,
  onFocusOn,
  onRemove,
  onMove,
  dragListeners,
  dragActivatorRef,
}: {
  task: Task;
  number: number;
  parentTitle: string | null;
  selected: boolean;
  canEdit: boolean;
  /** Its finished files (AT-3's 📎 mark; 0 hides it). */
  files: number;
  onSelect: () => void;
  onFocusOn: () => void;
  onRemove: () => void;
  onMove: (delta: 1 | -1) => void;
  dragListeners: DraggableSyntheticListeners;
  dragActivatorRef: DragActivatorRef;
}) {
  const est = estimateOf(task);
  return (
    <div
      ref={dragActivatorRef}
      {...(canEdit ? dragListeners : {})}
      data-task-id={task.id}
      data-focus-task={task.id}
      className={cn(
        "group flex min-h-(--row-h) items-center gap-2 rounded-md px-1.5",
        selected ? SELECTED_ROW : "hover:bg-state-hover",
      )}
    >
      <span className="w-5 shrink-0 text-right font-sans text-xs tabular-nums text-subtle-foreground">
        {number}
      </span>
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (!canEdit || !e.altKey || !e.shiftKey) return;
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            onMove(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-foreground">
          {task.title || "Untitled"}
          {parentTitle ? <span className="text-subtle-foreground"> · ↳ {parentTitle}</span> : null}
        </span>
      </button>
      <MetaCount icon={Paperclip} count={files} label={filesLabel} />
      <TaskClaimMark workspaceId={task.workspaceId} taskId={task.id} />
      {est ? (
        <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
          ~{formatDuration(est)}
        </span>
      ) : null}
      {canEdit ? (
        <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover:opacity-100 has-focus-visible:opacity-100">
          <IconButton
            icon={Play}
            label="Focus on this"
            tooltip={
              <>
                Focus on this <Kbd>⇧F</Kbd>
              </>
            }
            onClick={(e) => {
              e.stopPropagation();
              onFocusOn();
            }}
          />
          <IconButton
            icon={X}
            label="Remove from Focus"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          />
        </span>
      ) : null}
    </div>
  );
}
