// The task detail panel (tasks-v2 §9, comp §1 + §5 option C): one view of the
// right panel (hosted by Tasks, Calendar, Notes and Email), never the panel
// itself. Top to bottom: the header (bucket breadcrumb, queue toggle, copy link,
// ⋯), the checkbox + title, an auto-height description, the properties, the
// collections (Subtasks, Blocked by, Blocks, Linked: label · count · +), then
// comments & activity and the metadata line. Edits go through the module api
// (field-level `patchTask`); comments through the spine's `comments_op_add`.

import { isClosedTask } from "@contracts/vocabularies";
import { Ban, CircleDashed, ListChecks, Lock, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEntityHub } from "@/features/spine/hooks/use-entity-hub";
import { createLinkWithToast } from "@/features/spine/ui/drop-link-toast";
import { EntityHub } from "@/features/spine/ui/entity-hub";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
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
} from "../../../components/ui/command";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { detailTitleVariants } from "../../../components/ui/detail-title";
import { EmptyState } from "../../../components/ui/empty-state";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Separator } from "../../../components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { EntityLinkPicker } from "../../contacts/ui/entity-link-picker";
import { EntityTextEditor } from "../../spine/editor/entity-text-editor";
import { wouldCreateCycle } from "../helpers";
import { useTaskTimeShare } from "../hooks/use-task-time-share";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";
import { TaskDetailHeader } from "./task-detail-header";
import { TaskDetailProperties } from "./task-detail-properties";
import { TaskFeed } from "./task-feed";

type Props = {
  task: Task | null;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onRequestCapture: () => void;
  /** Move the app-level task selection (subtask ↔ parent navigation). */
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
  /** Spine runtime — when present (with a workspace), the linked-entity hub
   * (DF-8) and comments render. Optional so callers that don't wire the spine
   * degrade to the plain inspector. */
  runtime?: ModuoRuntime | null;
  workspaceId?: string | null;
  /** Open a linked entity from the hub. Defaults to the app-wide deep-link
   * event; callers that can select in place (Tasks, Calendar, Email, Notes)
   * pass their own. */
  onOpenEntity?: (ref: EntityRef) => void;
};

/**
 * A drag-to-link drop onto the task hub (DF-8) is persisted by the enclosing
 * page's DndContext; it dispatches this so the open task's hub re-pulls without
 * a re-select. Mirrors NO-7b's `NOTE_DETAIL_REFRESH_EVENT`.
 */
export const TASK_DETAIL_REFRESH_EVENT = "moduo:task:detail:refresh";

/** The entity types "Linked +" offers (tasks relate to tasks through Blocked by). */
const LINKABLE_TYPES = ["note", "contact", "company", "event"];

export function TaskDetailPanel({
  task,
  buckets,
  inbox,
  canEdit,
  onRequestCapture,
  onSelectTask,
  api,
  runtime = null,
  workspaceId = null,
  onOpenEntity,
}: Props) {
  if (!task) return <DetailEmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />;
  // Key on id so every local draft (title, revealed rows, feed fold) resets
  // when the selection changes.
  return (
    <DetailBody
      key={task.id}
      task={task}
      buckets={buckets}
      inbox={inbox}
      canEdit={canEdit}
      onSelectTask={onSelectTask}
      api={api}
      runtime={runtime}
      workspaceId={workspaceId}
      onOpenEntity={onOpenEntity}
    />
  );
}

function DetailBody({
  task,
  buckets,
  inbox,
  canEdit,
  onSelectTask,
  api,
  runtime,
  workspaceId,
  onOpenEntity,
}: {
  task: Task;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  onOpenEntity?: (ref: EntityRef) => void;
}) {
  // Subtasks are one level (spec §11): a live parent makes this a subtask, and
  // only top-level tasks offer the subtask list.
  const parent = task.parentId ? (api.tasks.find((t) => t.id === task.parentId) ?? null) : null;
  const mySeconds = useTaskTimeShare(
    runtime,
    workspaceId,
    api.currentUserId,
    task.id,
    task.timeSpentSeconds,
  );
  const done = task.status === "done";

  // ── linked-entity hub (DF-8: Tasks joins the spine) ──────────────────────────
  const hubFocus: EntityRef = { type: "task", id: task.id };
  const hub = useEntityHub(runtime, workspaceId, hubFocus);
  const hubReload = hub.reload;
  const showHub = !!runtime && !!workspaceId;
  // A drag-onto-hub link is persisted by the enclosing page's DndContext; re-pull
  // so the new edge shows without a re-select (NO-7b parity).
  useEffect(() => {
    if (!showHub) return;
    const onRefresh = () => hubReload();
    window.addEventListener(TASK_DETAIL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TASK_DETAIL_REFRESH_EVENT, onRefresh);
  }, [showHub, hubReload]);
  const openLinkedEntity =
    onOpenEntity ??
    ((ref: EntityRef) =>
      window.dispatchEvent(
        new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: ref.type, id: ref.id } }),
      ));
  const onChangeLinkKind =
    canEdit && runtime && workspaceId
      ? (link: EntityLink, kind: RelationKind) =>
          void runtime.spine
            .setLinkKind({ workspaceId, linkId: link.id, relationKind: kind })
            .then(hubReload)
      : undefined;
  const onUnlink =
    canEdit && runtime && workspaceId
      ? (link: EntityLink) =>
          void runtime.spine.deleteLink({ workspaceId, linkId: link.id }).then(hubReload)
      : undefined;
  const linkedCount = hub.sections.reduce((n, s) => n + s.count, 0);
  const linkEntity = (ref: EntityRef, label: string, icon: string | null) => {
    if (!runtime || !workspaceId) return;
    void (async () => {
      // An edge that already exists isn't news: a fresh Undo toast on it would
      // delete a link the person didn't make just now (FX-9 parity).
      try {
        const links = await runtime.spine.listLinks({
          workspaceId,
          entityType: "task",
          entityId: task.id,
        });
        if (
          links.some(
            (l) =>
              (l.sourceType === ref.type && l.sourceId === ref.id) ||
              (l.targetType === ref.type && l.targetId === ref.id),
          )
        ) {
          toast("Already linked");
          return;
        }
      } catch {
        // a failed pre-check must not block a legitimate link
      }
      await createLinkWithToast({
        runtime,
        workspaceId,
        source: { kind: "entity-drag", entityType: ref.type, entityId: ref.id, label, icon },
        target: { kind: "link-target", entityType: "task", entityId: task.id },
        origin: "manual",
        onChanged: hubReload,
      });
    })();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TaskDetailHeader
        task={task}
        parent={parent}
        buckets={buckets}
        inbox={inbox}
        canEdit={canEdit}
        api={api}
        onSelectTask={onSelectTask}
      />
      {/* px/py inset so a focused field's ring isn't clipped by this scroll box */}
      <div className="pane-scroll min-h-0 flex-1 overflow-y-auto px-1 pt-2.5 pb-4">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <CompleteToggle
                done={done}
                disabled={!canEdit}
                onToggle={() => api.toggleDone(task)}
                className="mt-1"
              />
              <TitleField task={task} canEdit={canEdit} api={api} />
            </div>
            {/* Description: no reserved box; `@` / `/` link entities inline (DF-23). */}
            {canEdit || task.description.trim() ? (
              <div className="pl-6">
                <EntityTextEditor
                  value={task.description}
                  editable={canEdit}
                  runtime={runtime}
                  workspaceId={workspaceId}
                  source={{ type: "task", id: task.id }}
                  sourceLabel={task.title}
                  sourceIcon="task"
                  ariaLabel="Description"
                  placeholder={canEdit ? "Add a description…  @ or / to link" : undefined}
                  className="min-h-6 text-base text-foreground/85"
                  placeholderClassName="text-base"
                  onCommit={(html) => {
                    if (html !== task.description) api.patchTask(task.id, { description: html });
                  }}
                />
              </div>
            ) : null}
          </div>

          {task.status === "archived" ? (
            <WontDoLine
              canEdit={canEdit}
              onReopen={() => api.patchTask(task.id, { status: "todo" })}
            />
          ) : null}

          <TaskDetailProperties task={task} api={api} canEdit={canEdit} mySeconds={mySeconds} />

          <div className="flex flex-col gap-2">
            {!parent ? (
              <SubtasksSection
                task={task}
                canEdit={canEdit}
                onSelectTask={onSelectTask}
                api={api}
              />
            ) : null}
            <BlockedBySection task={task} canEdit={canEdit} onSelectTask={onSelectTask} api={api} />
            <BlocksSection task={task} onSelectTask={onSelectTask} api={api} />
            {showHub && (canEdit || linkedCount > 0 || hub.status === "error") ? (
              <div>
                <CollectionHeader
                  label="Linked"
                  count={linkedCount}
                  action={
                    canEdit ? (
                      <EntityLinkPicker
                        runtime={runtime}
                        workspaceId={workspaceId}
                        types={LINKABLE_TYPES}
                        placeholder="Link a note, contact, event…"
                        emptyLabel="Nothing to link."
                        trigger={<IconButton icon={Plus} label="Link something" />}
                        onPick={(c) => {
                          if (c.kind === "entity") linkEntity(c.ref, c.label, c.icon);
                        }}
                      />
                    ) : null
                  }
                />
                {linkedCount > 0 || hub.status === "error" ? (
                  <EntityHub
                    variant="rail"
                    status={hub.status}
                    sections={hub.sections}
                    canEdit={canEdit}
                    onOpen={openLinkedEntity}
                    onChangeKind={onChangeLinkKind}
                    onUnlink={onUnlink}
                    onRetry={hubReload}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <Separator className="bg-hairline" />

          <TaskFeed task={task} api={api} runtime={runtime} workspaceId={workspaceId} />
        </div>
      </div>
    </div>
  );
}

// ── title ─────────────────────────────────────────────────────────────────────

/** The title, wrapping and growing with its text; Enter or blur saves, Esc reverts. */
function TitleField({ task, canEdit, api }: { task: Task; canEdit: boolean; api: TasksModuleApi }) {
  const [title, setTitle] = useState(task.title);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Follow a change made elsewhere (another tab, a teammate) while not editing.
  useEffect(() => {
    if (document.activeElement !== ref.current) setTitle(task.title);
  }, [task.title]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const commit = () => {
    const next = title.replace(/\s+/g, " ").trim();
    if (!next)
      setTitle(task.title); // refuse empty: restore
    else if (next !== task.title) api.patchTask(task.id, { title: next });
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={title}
      readOnly={!canEdit}
      aria-label="Task title"
      onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setTitle(task.title);
          // Revert first, then leave: blur would otherwise save the draft.
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className={cn(
        detailTitleVariants({ size: "lead" }),
        "min-w-0 flex-1 resize-none overflow-hidden rounded-md bg-transparent outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        task.status === "done" && "text-muted-foreground",
      )}
    />
  );
}

// ── collections ───────────────────────────────────────────────────────────────
// Every collection's header is the kit's CollectionHeader: label · count · + (comp §1).

function SubtasksSection({
  task,
  canEdit,
  onSelectTask,
  api,
}: {
  task: Task;
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const subtasks = api.subtasksByParent.get(task.id) ?? [];
  const progress = api.subtaskProgressByTask.get(task.id);

  if (subtasks.length === 0 && !canEdit) return null;

  const submit = () => {
    const next = draft.trim();
    if (next) api.addSubtask(task.id, next);
    setDraft("");
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
        <div className="flex flex-col">
          {subtasks.map((subtask) => (
            <SubtaskRow
              key={subtask.id}
              subtask={subtask}
              canEdit={canEdit}
              onSelect={() => onSelectTask(subtask.id)}
              api={api}
            />
          ))}
        </div>
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
              submit(); // stays open for rapid entry
            } else if (e.key === "Escape") {
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

function SubtaskRow({
  subtask,
  canEdit,
  onSelect,
  api,
}: {
  subtask: Task;
  canEdit: boolean;
  onSelect: () => void;
  api: TasksModuleApi;
}) {
  const done = subtask.status === "done";
  const queued = api.queuedTaskIds.has(subtask.id);
  return (
    <div className="group flex min-h-(--ctrl-h-sm) items-center gap-2 rounded-md px-1 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover">
      <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(subtask)} />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          // Titles wrap in the panel, never truncate (TV-P0, AC1.16).
          "min-w-0 flex-1 break-words py-0.5 text-left font-sans text-base",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {subtask.title || "Untitled"}
      </button>
      {/* individually queueable: start a scary task through its smallest step */}
      {(canEdit && !done) || queued ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!canEdit}
              aria-label={queued ? "Remove from queue" : "Add to queue"}
              aria-pressed={queued}
              onClick={() => api.toggleQueue(subtask.id)}
              className={cn(
                // hit-min pads the pointer target to 24 px; the glyph stays put.
                "hit-min flex size-5 shrink-0 items-center justify-center rounded transition-opacity duration-(--motion-fade) ease-(--ease-out)",
                "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                queued
                  ? "text-primary"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground",
              )}
            >
              <ListChecks className="size-icon-sm" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{queued ? "Queued. Click to remove" : "Add to queue"}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function BlockedBySection({
  task,
  canEdit,
  onSelectTask,
  api,
}: {
  task: Task;
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  // Edges, never a stored status (spec §5c).
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
          onSelect={() => onSelectTask(blocker.id)}
          onRemove={canEdit ? () => api.removeBlocker(task.id, blocker.id) : undefined}
        />
      ))}
    </div>
  );
}

function BlocksSection({
  task,
  onSelectTask,
  api,
}: {
  task: Task;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  const dependents = api.dependentsByTask.get(task.id) ?? [];
  if (dependents.length === 0) return null;
  return (
    <div>
      <CollectionHeader label="Blocks" count={dependents.length} />
      {dependents.map((d) => (
        <RelatedTaskRow key={d.id} task={d} onSelect={() => onSelectTask(d.id)} />
      ))}
    </div>
  );
}

/** A quiet related-task row: click-through title, optional ✕ (removes the
 * edge, never the task). Done tasks render struck through. */
function RelatedTaskRow({
  task,
  onSelect,
  onRemove,
}: {
  task: Task;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const closed = isClosedTask(task);
  return (
    <div className="group flex min-h-(--ctrl-h-sm) items-center gap-2 rounded-md px-1 transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover">
      <CircleDashed className="size-icon-sm shrink-0 text-muted-foreground/70" aria-hidden />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 break-words py-0.5 text-left font-sans text-base",
          closed ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {task.title || "Untitled"}
      </button>
      {onRemove ? (
        // Revealed on row hover or focus: it keeps its space and fades (R6).
        // hit-min keeps a 24 px target on the dense rung.
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

/** Searchable picker for a new blocker: open, live tasks only; tasks that
 * would close a cycle are left out (the hook + DB trigger backstop). */
function BlockerPicker({ task, api }: { task: Task; api: TasksModuleApi }) {
  const [open, setOpen] = useState(false);
  const currentBlockerIds = new Set((api.blockersByTask.get(task.id) ?? []).map((b) => b.id));
  const candidates = api.tasks.filter(
    (t) =>
      t.id !== task.id &&
      t.status !== "done" &&
      t.status !== "archived" &&
      !currentBlockerIds.has(t.id) &&
      !wouldCreateCycle(t.id, task.id, api.taskRelations),
  );
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

// ── empty / teaching state ─────────────────────────────────────────────────────

/**
 * A Won't do task reads as one, with Reopen right there (TV-P0, tasks-v3
 * AC1.4): Won't do ends a task without doing it, and it can always come back.
 */
function WontDoLine({ canEdit, onReopen }: { canEdit: boolean; onReopen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted px-2 py-1.5 font-sans text-sm text-muted-foreground">
      <Ban className="size-icon-sm shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">Won’t do</span>
      {canEdit ? (
        <Button variant="ghost" size="sm" onClick={onReopen}>
          <RotateCcw aria-hidden />
          Reopen
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A link to a task you can't open (TV-P0, AC1.10): "Private item", never
 * another task in its place. It may also have been deleted; the panel can't
 * tell the two apart without the server (RF-1 makes the registry answer).
 */
export function PrivateItemPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
      <Lock className="size-icon text-muted-foreground" aria-hidden />
      <p className="font-display text-sm text-foreground">Private item</p>
      <p className="text-xs text-muted-foreground">
        This task isn’t shared with you, or it no longer exists.
      </p>
      <Button variant="ghost" size="sm" className="mt-1" onClick={onBack}>
        Back to your tasks
      </Button>
    </div>
  );
}

function DetailEmptyState({
  canEdit,
  onRequestCapture,
}: {
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  return (
    <EmptyState
      title="No task selected"
      description="Pick a task to see and edit its details here."
      hint={
        canEdit ? (
          <>
            Press <Kbd>c</Kbd> to {/* A link inside the sentence: a Button would break the line. */}
            <button
              type="button"
              onClick={onRequestCapture}
              className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              capture
            </button>{" "}
            a new one.
          </>
        ) : undefined
      }
    />
  );
}
