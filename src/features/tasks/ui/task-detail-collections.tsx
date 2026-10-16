// The detail panel's collections (Tasks v3 §9, research views-board-detail
// §7 + §11), each under the kit's CollectionHeader (label · count · +):
// - Subtasks "2/5": a row is toggle · title · its due · its assignee when
//   it's someone else; clicking one opens its own details in the panel
//   ("← parent", call 65a); "+" or ⏎ at the end of the last one adds; done
//   ones stay in place, struck through; a drag or ⌥⇧↑/↓ reorders them
//   (TV-U10: a parent's subtasks keep their own order in every view).
// - Waiting on: people or a typed note, each with "since" (a list, not a
//   property: default q).
// - Blocked by / Blocks: tasks, one dependency store (TV-D8).
// - Linked: reference cards (RF-1), folded after five.

import { isClosedTask } from "@contracts/vocabularies";
import { closestCenter, DndContext, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CircleDashed, Hourglass, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { Button } from "../../../components/ui/button";
import { CollectionHeader } from "../../../components/ui/collection-header";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../../components/ui/command";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { DRAG_SOURCE } from "../../../components/ui/drag-visuals";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { formatDate, formatDay } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import { MentionedInLines } from "../../chat/mentioned-in";
import { EntityLinkPicker } from "../../contacts/ui/entity-link-picker";
import { Reference } from "../../spine/references/ui/reference";
import type { HubRow } from "../../spine/rollup";
import { assigneeListName, SELF_KEYWORDS } from "../assignee-options";
import { useAssignees } from "../assignees";
import { onBreakDown, takeBreakDown } from "../break-down";
import { wouldCreateCycle } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task, TaskWaitingEntry } from "../model";
import { subtaskPositionAt } from "../subtask-order";
import { AssigneeAvatar } from "./assignee-avatar";
import { useTaskDndSensors } from "./dnd/task-dnd";

// ── Subtasks ──────────────────────────────────────────────────────────────────

export function SubtasksSection({
  task,
  canEdit,
  onOpenTask,
  api,
}: {
  task: Task;
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const subtasks = api.subtasksByParent.get(task.id) ?? [];
  const progress = api.subtaskProgressByTask.get(task.id);
  // A late row's "Break down" (TV-U10) opens the subtask line here, whether
  // this panel shows the task already or is about to.
  const taskId = task.id;
  useEffect(() => {
    if (!canEdit) return;
    const take = () => {
      if (takeBreakDown(taskId)) setAdding(true);
    };
    take();
    return onBreakDown(take);
  }, [taskId, canEdit]);

  // A drag or ⌥⇧↑/↓ moves a subtask among its siblings (TV-U10), with the
  // drop's Undo. The pointer only: the keys are the keyboard's way.
  const sensors = useTaskDndSensors({ keyboard: false });

  if (subtasks.length === 0 && !canEdit) return null;

  const submit = () => {
    const next = draft.trim();
    if (next) api.addSubtask(task.id, next);
    setDraft("");
  };
  const moveTo = (subtaskId: string, toIndex: number) => {
    const from = subtasks.findIndex((s) => s.id === subtaskId);
    const position = subtaskPositionAt(api.tasks, subtasks, subtaskId, toIndex);
    if (position === null) return;
    void api.dropTask({ taskId: subtaskId, position }, toIndex < from ? "Moved up" : "Moved down");
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    moveTo(
      String(active.id),
      subtasks.findIndex((s) => s.id === over.id),
    );
  };

  return (
    <div>
      <CollectionHeader
        label="Subtasks"
        count={progress && progress.total > 0 ? `${progress.done}/${progress.total}` : 0}
        action={
          canEdit ? (
            <IconButton icon={Plus} label="Add subtask" onClick={() => setAdding(true)} />
          ) : null
        }
      />
      {subtasks.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={VERTICAL_ONLY}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={subtasks.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
            disabled={!canEdit}
          >
            <div className="flex flex-col">
              {subtasks.map((subtask, i) => (
                <SubtaskRow
                  key={subtask.id}
                  subtask={subtask}
                  parent={task}
                  canEdit={canEdit}
                  last={i === subtasks.length - 1}
                  onOpen={() => onOpenTask(subtask.id)}
                  onAddAfter={() => setAdding(true)}
                  onMove={(delta) => moveTo(subtask.id, i + delta)}
                  api={api}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : null}
      {canEdit && adding ? (
        <Input
          autoFocus
          size="sm"
          value={draft}
          placeholder="Add a subtask…"
          aria-label="New subtask title"
          className="mt-1"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(); // stays open for the next one, like a checklist
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setDraft("");
              setAdding(false);
            }
          }}
          onBlur={() => {
            submit();
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** A dragged subtask moves up and down only. */
const VERTICAL_ONLY: Modifier[] = [({ transform }) => ({ ...transform, x: 0 })];

function SubtaskRow({
  subtask,
  parent,
  canEdit,
  last,
  onOpen,
  onAddAfter,
  onMove,
  api,
}: {
  subtask: Task;
  parent: Task;
  canEdit: boolean;
  last: boolean;
  onOpen: () => void;
  onAddAfter: () => void;
  /** ⌥⇧↑/↓: one place up (-1) or down (1) among its siblings. */
  onMove: (delta: 1 | -1) => void;
  api: TasksModuleApi;
}) {
  const { byId } = useAssignees();
  const openRef = useRef<HTMLButtonElement>(null);
  // The whole row drags (past a few pixels, so a click still opens or checks).
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: subtask.id,
    disabled: !canEdit,
  });
  const done = subtask.status === "done";
  const closed = isClosedTask(subtask);
  // The avatar only when it isn't the parent's assignee (research §11).
  const assignee =
    subtask.assigneeId && subtask.assigneeId !== parent.assigneeId
      ? byId(subtask.assigneeId)
      : null;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(canEdit ? listeners : {})}
      data-subtask-row={subtask.id}
      className={cn(
        "group flex min-h-(--row-h) items-center gap-2 rounded-md px-1 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
        isDragging && ["relative z-10", DRAG_SOURCE],
      )}
    >
      <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(subtask)} />
      <button
        ref={openRef}
        type="button"
        onClick={onOpen}
        onKeyDown={(e) => {
          // ⏎ opens it; ⇧⏎ on the last one adds the next, like a checklist.
          if (e.key === "Enter" && e.shiftKey && last && canEdit) {
            e.preventDefault();
            onAddAfter();
            return;
          }
          // ⌥⇧↑/↓ moves it, and the focus stays on it in its new place.
          if (canEdit && e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            e.stopPropagation();
            onMove(e.key === "ArrowUp" ? -1 : 1);
            requestAnimationFrame(() => openRef.current?.focus());
          }
        }}
        aria-keyshortcuts={canEdit ? "Alt+Shift+ArrowUp Alt+Shift+ArrowDown" : undefined}
        aria-label={`Open subtask: ${subtask.title || "Untitled"}`}
        className={cn(
          // Titles wrap in the panel, never truncate (AC1.16).
          "hit-min min-w-0 flex-1 break-words rounded-sm py-0.5 text-left font-sans text-base",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          closed ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {subtask.title || "Untitled"}
      </button>
      {subtask.dueDate ? (
        <span className="shrink-0 whitespace-nowrap font-sans text-xs text-muted-foreground tabular-nums">
          {formatDay(subtask.dueDate)}
        </span>
      ) : null}
      {assignee ? <AssigneeAvatar assignee={assignee} size="icon" /> : null}
    </div>
  );
}

// ── Waiting on… ───────────────────────────────────────────────────────────────

export function WaitingSection({
  task,
  entries,
  canEdit,
  api,
  defaultOpen = false,
}: {
  task: Task;
  entries: TaskWaitingEntry[];
  canEdit: boolean;
  api: TasksModuleApi;
  defaultOpen?: boolean;
}) {
  const { assignees, byId } = useAssignees();
  const [open, setOpen] = useState(defaultOpen && canEdit);
  const [text, setText] = useState("");
  const waitingOnPeople = new Set(entries.filter((e) => e.kind === "person").map((e) => e.ref));
  const addText = () => {
    const label = text.trim();
    if (!label) return;
    api.addWaiting(task.id, { kind: "text", label });
    setText("");
    setOpen(false);
  };
  return (
    <div>
      <CollectionHeader
        label="Waiting on"
        count={entries.length}
        action={
          canEdit ? (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <IconButton icon={Plus} label="Wait on someone or something" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-0">
                <Command>
                  <CommandInput placeholder="Someone…" />
                  <CommandList>
                    <CommandEmpty>Nobody by that name.</CommandEmpty>
                    <CommandGroup heading="People">
                      {assignees
                        .filter((a) => !waitingOnPeople.has(a.userId))
                        .map((a) => (
                          <CommandItem
                            key={a.userId}
                            value={`${a.name} ${a.fullName} ${a.isMe ? SELF_KEYWORDS.join(" ") : ""} ${a.userId}`}
                            onSelect={() => {
                              api.addWaiting(task.id, { kind: "person", ref: a.userId });
                              setOpen(false);
                            }}
                          >
                            <AssigneeAvatar assignee={a} size="icon" />
                            <span className="min-w-0 flex-1 break-words">
                              {assigneeListName(a)}
                            </span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                  <CommandSeparator />
                </Command>
                <div className="flex items-center gap-1.5 border-t border-hairline p-2">
                  <Input
                    size="sm"
                    value={text}
                    placeholder="Something else…"
                    aria-label="Waiting on something else"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addText();
                      }
                    }}
                  />
                  <Button size="sm" variant="secondary" disabled={!text.trim()} onClick={addText}>
                    Add
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          ) : null
        }
      />
      {entries.map((entry) => {
        const person = entry.kind === "person" ? byId(entry.ref) : null;
        const label =
          entry.kind === "person"
            ? (person?.name ?? "Former member")
            : entry.kind === "text"
              ? (entry.label ?? "Something")
              : entry.kind === "email"
                ? "An email"
                : "An agent";
        return (
          <div
            key={entry.id}
            className="group flex min-h-(--ctrl-h-sm) items-center gap-2 rounded-md px-1 font-sans text-base hover:bg-state-hover"
          >
            {person ? (
              <AssigneeAvatar assignee={person} size="icon" />
            ) : (
              <Hourglass className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="min-w-0 flex-1 break-words">{label}</span>
            <span className="shrink-0 whitespace-nowrap font-sans text-xs text-muted-foreground">
              since {formatDate(entry.since)}
            </span>
            {canEdit ? (
              <IconButton
                icon={X}
                label="Stop waiting"
                onClick={() => api.removeWaiting(entry.id)}
                className="hit-min opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Blocked by · Blocks ───────────────────────────────────────────────────────

export function BlockedBySection({
  task,
  canEdit,
  onOpenTask,
  api,
}: {
  task: Task;
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  // Edges, never a stored status.
  const blockers = api.blockersByTask.get(task.id) ?? [];
  if (blockers.length === 0 && !canEdit) return null;
  return (
    <div>
      <CollectionHeader
        label="Blocked by"
        count={blockers.length}
        action={canEdit ? <BlockerPicker task={task} api={api} /> : null}
      />
      {blockers.map((blocker) => (
        <RelatedTaskRow
          key={blocker.id}
          task={blocker}
          onOpen={() => onOpenTask(blocker.id)}
          onRemove={canEdit ? () => api.removeBlocker(task.id, blocker.id) : undefined}
        />
      ))}
    </div>
  );
}

export function BlocksSection({
  task,
  onOpenTask,
  api,
}: {
  task: Task;
  onOpenTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  const dependents = api.dependentsByTask.get(task.id) ?? [];
  if (dependents.length === 0) return null;
  return (
    <div>
      <CollectionHeader label="Blocks" count={dependents.length} />
      {dependents.map((d) => (
        <RelatedTaskRow key={d.id} task={d} onOpen={() => onOpenTask(d.id)} />
      ))}
    </div>
  );
}

/** A quiet related-task row: click-through title, optional ✕ (removes the edge, never the task). */
function RelatedTaskRow({
  task,
  onOpen,
  onRemove,
}: {
  task: Task;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const closed = isClosedTask(task);
  return (
    <div className="group flex min-h-(--ctrl-h-sm) items-center gap-2 rounded-md px-1 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover">
      <CircleDashed className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "min-w-0 flex-1 break-words rounded-sm py-0.5 text-left font-sans text-base",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          closed ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {task.title || "Untitled"}
      </button>
      {onRemove ? (
        <IconButton
          icon={X}
          label="Remove dependency"
          tooltip="Remove dependency (keeps the task)"
          onClick={onRemove}
          className="hit-min text-muted-foreground opacity-0 transition-[color,background-color,opacity] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        />
      ) : null}
    </div>
  );
}

/** A new blocker: open, live tasks only; tasks that would close a loop are left out. */
function BlockerPicker({ task, api }: { task: Task; api: TasksModuleApi }) {
  const [open, setOpen] = useState(false);
  const currentBlockerIds = new Set((api.blockersByTask.get(task.id) ?? []).map((b) => b.id));
  const candidates = open
    ? api.tasks.filter(
        (t) =>
          t.id !== task.id &&
          !isClosedTask(t) &&
          !currentBlockerIds.has(t.id) &&
          !wouldCreateCycle(t.id, task.id, api.taskRelations),
      )
    : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton icon={Plus} label="Add blocker" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end">
        <Command>
          <CommandInput placeholder="Blocked by…" />
          <CommandList>
            <CommandEmpty>No matching open tasks.</CommandEmpty>
            <CommandGroup>
              {candidates.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.title || "Untitled"} ${t.id}`}
                  onSelect={() => {
                    api.addBlocker(task.id, t.id);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 break-words">{t.title || "Untitled"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Linked (reference cards) ──────────────────────────────────────────────────

/** Linked shows this many cards, then "Show n more". */
export const LINKED_VISIBLE = 5;

/** The entity types "Linked +" offers (tasks relate to tasks through Blocked by). */
const LINKABLE_TYPES = ["note", "contact", "company", "event"];

export function LinkedSection({
  rows,
  status,
  canEdit,
  runtime,
  workspaceId,
  onLink,
  onUnlink,
  onRetry,
  focus,
}: {
  /** The task: its "Mentioned in" lines show under the cards (CV-10). */
  focus?: EntityRef;
  rows: HubRow[];
  status: "loading" | "error" | "ready";
  canEdit: boolean;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  onLink: (ref: EntityRef, label: string, icon: string | null) => void;
  onUnlink: (row: HubRow) => void;
  onRetry: () => void;
}) {
  const [all, setAll] = useState(false);
  const mentioned = focus ? <MentionedInLines entityType={focus.type} entityId={focus.id} /> : null;
  if (rows.length === 0 && !canEdit && status !== "error") return mentioned;
  const shown = all ? rows : rows.slice(0, LINKED_VISIBLE);
  return (
    <div>
      <CollectionHeader
        label="Linked"
        count={rows.length}
        action={
          canEdit && runtime && workspaceId ? (
            <EntityLinkPicker
              runtime={runtime}
              workspaceId={workspaceId}
              types={LINKABLE_TYPES}
              placeholder="Link a note, contact, event…"
              emptyLabel="Nothing to link."
              trigger={<IconButton icon={Plus} label="Link something" />}
              onPick={(c) => {
                if (c.kind === "entity") onLink(c.ref, c.label, c.icon);
              }}
            />
          ) : null
        }
      />
      {status === "error" ? (
        <p className="font-sans text-xs text-muted-foreground">
          Linked items didn’t load.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="-my-1 px-1.5 font-sans text-xs font-normal text-muted-foreground"
          >
            Retry
          </Button>
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {shown.map((row) => (
          <div key={row.link.id} className="group relative">
            <Reference
              type={row.other.type}
              id={row.other.id}
              display="card"
              fallbackLabel={row.title}
            />
            {canEdit ? (
              <IconButton
                icon={X}
                label="Unlink"
                tooltip="Unlink (keeps the item)"
                onClick={() => onUnlink(row)}
                className="absolute top-1 right-1 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              />
            ) : null}
          </div>
        ))}
      </div>
      {!all && rows.length > LINKED_VISIBLE ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAll(true)}
          className="-ms-2 mt-1 font-sans text-xs font-normal text-muted-foreground"
        >
          Show {rows.length - LINKED_VISIBLE} more
        </Button>
      ) : null}
      {mentioned}
    </div>
  );
}

/** Say a failed unlink once, quietly. */
export function sayUnlinkFailed(e: unknown) {
  toast.error(e instanceof Error ? e.message : "Couldn’t unlink it.");
}
