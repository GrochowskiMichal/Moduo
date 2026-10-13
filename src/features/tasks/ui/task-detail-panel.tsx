// The task's details (Tasks v3 §9, research views-board-detail §7–12): one
// view of the right panel (hosted by Tasks, Calendar, Notes and Email), and
// the full page in the centre (call 32). Top to bottom: the header (project
// › section, handle, a claims slot, queue, ⤢, ⋯), the status toggle and the
// title, the agent session line's slot, the Done / Won't do line, the
// properties, the description (folded at ~8 lines in the panel) and its
// attachments (AT-2: files pasted or dropped anywhere on the task attach to
// it), the collections (Subtasks, Waiting on, Blocked by, Blocks, Linked),
// then one feed. On the full page the properties take a column of their own on the
// right once there's room, and the description never folds.
//
// States: nothing selected (inside a project the page shows the Project
// view instead), a deleted task ("Deleted task", Restore when you can edit),
// a task you can't see ("Private item"), read-only (values inert, the
// composer stays).

import { isClosedTask, taskCategoryOf } from "@contracts/vocabularies";
import { Ban, Check, Lock, RotateCcw, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AttachmentsSection,
  useAttachmentsSection,
} from "@/features/attachments/ui/attachments-section";
import { useEntityHub } from "@/features/spine/hooks/use-entity-hub";
import { createLinkWithToast } from "@/features/spine/ui/drop-link-toast";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { detailTitleVariants } from "../../../components/ui/detail-title";
import { DROP_TARGET } from "../../../components/ui/drag-visuals";
import { EmptyState } from "../../../components/ui/empty-state";
import { Kbd } from "../../../components/ui/kbd";
import { Separator } from "../../../components/ui/separator";
import { formatDate } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import { useReference } from "../../spine/references/context";
import { activityActorName } from "../activity";
import { useAssignees } from "../assignees";
import { feedTime } from "../feed";
import { useTaskTimeShare } from "../hooks/use-task-time-share";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { ActivityEntry, Bucket, Task } from "../model";
import { TaskDescription } from "./task-description";
import {
  BlockedBySection,
  BlocksSection,
  LinkedSection,
  SubtasksSection,
  sayUnlinkFailed,
  WaitingSection,
} from "./task-detail-collections";
import { TaskDetailHeader } from "./task-detail-header";
import { TaskDetailProperties } from "./task-detail-properties";
import { TaskFeed } from "./task-feed";

type Props = {
  task: Task | null;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onRequestCapture: () => void;
  /** Move the page's task selection (a duplicate opens there). */
  onSelectTask: (id: string) => void;
  /** Open a task in the panel on top of this one ("← item", call 65a): a
   *  subtask, a blocker, the parent. Defaults to selecting it. */
  onOpenTask?: (id: string) => void;
  api: TasksModuleApi;
  /** Spine runtime: the linked items, comments and the feed. Optional so a
   *  host that doesn't wire the spine gets the plain inspector. */
  runtime?: ModuoRuntime | null;
  workspaceId?: string | null;
  /** Kept for hosts that pass it; Linked cards open through the page's
   *  reference host (RF-1) since TV-U13. */
  onOpenEntity?: (ref: EntityRef) => void;
  /** ⤢: show the task as the full page (Tasks only). */
  onOpenFullPage?: () => void;
  /** ⤡: back from the full page to the panel. */
  onCloseFullPage?: () => void;
  /** "page": the full page's two-column layout; the description never folds. */
  layout?: "panel" | "page";
  /** Who "is on this" (claims): TV-F7 fills it. */
  claimSlot?: ReactNode;
};

/**
 * A drag-to-link drop onto the task hub (DF-8) is persisted by the enclosing
 * page's DndContext; it dispatches this so the open task's hub re-pulls without
 * a re-select. Mirrors NO-7b's `NOTE_DETAIL_REFRESH_EVENT`.
 */
export const TASK_DETAIL_REFRESH_EVENT = "moduo:task:detail:refresh";

export function TaskDetailPanel(props: Props) {
  const { task, canEdit, onRequestCapture } = props;
  if (!task) return <DetailEmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />;
  // Key on id so every local draft (title, revealed rows, feed fold) resets
  // when the selection changes.
  return <DetailBody key={task.id} {...props} task={task} />;
}

function DetailBody({
  task,
  buckets,
  inbox,
  canEdit,
  onSelectTask,
  onOpenTask,
  api,
  runtime = null,
  workspaceId = null,
  onOpenFullPage,
  onCloseFullPage,
  layout = "panel",
  claimSlot,
}: Props & { task: Task }) {
  // Subtasks are one level (spec §1): a live parent makes this a subtask, and
  // only top-level tasks have a Subtasks collection.
  const parent = task.parentId ? (api.tasks.find((t) => t.id === task.parentId) ?? null) : null;
  const openTask = onOpenTask ?? onSelectTask;
  const mySeconds = useTaskTimeShare(
    runtime,
    workspaceId,
    api.currentUserId,
    task.id,
    task.timeSpentSeconds,
  );
  const done = task.status === "done";
  const waiting = api.waiting.filter((w) => w.taskId === task.id);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const bucket = buckets.find((b) => b.id === task.bucketId) ?? null;
  // Full access to the project deletes anyone's comment (the server decides;
  // the owner is the one we can tell here).
  const canRemoveAny =
    canEdit && !!bucket && !bucket.isSystem && bucket.ownerId === api.currentUserId;
  const projects = buckets.filter((b) => !b.isSystem && !b.archivedAt);

  // ── attachments (AT-2): one self-contained section ─────────────────────────
  const files = useAttachmentsSection({
    runtime,
    // The task's own workspace: that's where its files live.
    workspaceId: workspaceId ? task.workspaceId || workspaceId : null,
    entity: { type: "task", id: task.id },
    userId: api.currentUserId ?? null,
    canEdit,
  });
  const dropScroll = cn(
    "pane-scroll min-h-0 flex-1 overflow-y-auto rounded-lg transition-[background-color,box-shadow] duration-(--motion-fade) ease-(--ease-out)",
    files.dropActive && DROP_TARGET,
  );

  // ── linked items (DF-8, as reference cards since TV-U13) ───────────────────
  const hubFocus: EntityRef = { type: "task", id: task.id };
  const hub = useEntityHub(runtime, workspaceId, hubFocus);
  const hubReload = hub.reload;
  const showHub = !!runtime && !!workspaceId;
  useEffect(() => {
    if (!showHub) return;
    const onRefresh = () => hubReload();
    window.addEventListener(TASK_DETAIL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TASK_DETAIL_REFRESH_EVENT, onRefresh);
  }, [showHub, hubReload]);
  const linkedRows = hub.sections.flatMap((s) => s.rows);
  const linkEntity = (ref: EntityRef, label: string, icon: string | null) => {
    if (!runtime || !workspaceId) return;
    void (async () => {
      // An edge that already exists isn't news (FX-9 parity).
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

  const title = (
    <div className="flex items-start gap-2">
      <CompleteToggle
        done={done}
        disabled={!canEdit}
        onToggle={() => api.toggleDone(task)}
        className="mt-1"
      />
      <TitleField
        task={task}
        canEdit={canEdit}
        api={api}
        size={layout === "page" ? "page" : "lead"}
      />
    </div>
  );
  const closedLine =
    task.status === "archived" ? (
      <WontDoLine canEdit={canEdit} onReopen={() => api.patchTask(task.id, { status: "todo" })} />
    ) : taskCategoryOf(task) === "done" ? (
      <DoneLine task={task} />
    ) : null;
  const properties = (
    <TaskDetailProperties
      task={task}
      api={api}
      canEdit={canEdit}
      mySeconds={mySeconds}
      projects={projects}
      waitingShown={waiting.length > 0 || waitingOpen}
      onRevealWaiting={() => setWaitingOpen(true)}
    />
  );
  const description = (
    <>
      <TaskDescription
        task={task}
        api={api}
        canEdit={canEdit}
        runtime={runtime}
        workspaceId={workspaceId}
        foldable={layout === "panel"}
        onFiles={files.onEditorFiles}
      />
      <AttachmentsSection state={files} className="mt-1" />
    </>
  );
  const collections = (
    <div className="flex flex-col gap-3">
      {!parent ? (
        <SubtasksSection task={task} canEdit={canEdit} onOpenTask={openTask} api={api} />
      ) : null}
      {waiting.length > 0 || waitingOpen ? (
        <WaitingSection
          task={task}
          entries={waiting}
          canEdit={canEdit}
          api={api}
          defaultOpen={waitingOpen && waiting.length === 0}
        />
      ) : null}
      <BlockedBySection task={task} canEdit={canEdit} onOpenTask={openTask} api={api} />
      <BlocksSection task={task} onOpenTask={openTask} api={api} />
      {showHub ? (
        <LinkedSection
          rows={linkedRows}
          status={hub.status}
          canEdit={canEdit}
          runtime={runtime}
          workspaceId={workspaceId}
          onLink={linkEntity}
          onUnlink={(row) => {
            if (!runtime || !workspaceId) return;
            void runtime.spine
              .deleteLink({ workspaceId, linkId: row.link.id })
              .then(hubReload)
              .catch(sayUnlinkFailed);
          }}
          onRetry={hubReload}
        />
      ) : null}
    </div>
  );
  const feed = (
    <TaskFeed
      task={task}
      api={api}
      runtime={runtime}
      workspaceId={workspaceId}
      canRemoveAny={canRemoveAny}
    />
  );
  const header = (
    <TaskDetailHeader
      task={task}
      parent={parent}
      buckets={buckets}
      inbox={inbox}
      canEdit={canEdit}
      api={api}
      onOpenTask={openTask}
      onSelectTask={onSelectTask}
      onOpenFullPage={onOpenFullPage}
      onCloseFullPage={onCloseFullPage}
      claimSlot={claimSlot}
    />
  );

  if (layout === "page") {
    // Two columns once the centre is wide enough (≈880 px); one below.
    return (
      // A drop or paste anywhere on the task attaches the files; the
      // description editor hands its own to `onFiles` (Lexical owns those).
      <section
        aria-label="Task details"
        className="@container flex h-full min-h-0 flex-col"
        data-layout="page"
        {...files.dropZone}
      >
        {header}
        <div
          data-drop-active={files.dropActive || undefined}
          className={cn(dropScroll, "px-1 pt-3 pb-6")}
        >
          <div className="flex flex-col gap-6 @4xl:flex-row @4xl:items-start">
            <div className="flex min-w-0 max-w-180 flex-1 flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                {title}
                <AgentSessionSlot task={task} />
              </div>
              <div className="flex flex-col gap-3 @4xl:hidden">
                {closedLine}
                {properties}
              </div>
              <div className="pl-6">{description}</div>
              {collections}
              <Separator className="bg-hairline" />
              {feed}
            </div>
            <aside
              aria-label="Properties"
              className="hidden w-70 shrink-0 flex-col gap-3 @4xl:sticky @4xl:top-0 @4xl:flex"
            >
              {closedLine}
              {properties}
            </aside>
          </div>
        </div>
      </section>
    );
  }

  return (
    // A drop or paste anywhere on the task attaches the files; the description
    // editor hands its own to `onFiles` (Lexical owns those events).
    <section
      aria-label="Task details"
      className="@container flex h-full min-h-0 flex-col"
      data-layout="panel"
      {...files.dropZone}
    >
      {header}
      {/* px/py inset so a focused field's ring isn't clipped by this scroll box */}
      <div
        data-drop-active={files.dropActive || undefined}
        className={cn(dropScroll, "px-1 pt-2.5 pb-4")}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            {title}
            <AgentSessionSlot task={task} />
          </div>
          {closedLine}
          {properties}
          <div className="pl-6">{description}</div>
          {collections}
          <Separator className="bg-hairline" />
          {feed}
        </div>
      </div>
    </section>
  );
}

/**
 * The agent session line (call 52) goes directly under the title: "Claude ·
 * Writing tests · step 3 of 5 · 2m ago · PR #42 ↗". TV-D16 brings agent
 * sessions; until then there is nothing to show, and this slot keeps its place.
 */
function AgentSessionSlot(_props: { task: Task }) {
  return null;
}

// ── title ─────────────────────────────────────────────────────────────────────

/** The title, wrapping and growing with its text; Enter or blur saves, Esc reverts. */
function TitleField({
  task,
  canEdit,
  api,
  size,
}: {
  task: Task;
  canEdit: boolean;
  api: TasksModuleApi;
  size: "lead" | "page";
}) {
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
        detailTitleVariants({ size }),
        size === "page" && "font-semibold leading-snug tracking-tight",
        "min-w-0 flex-1 resize-none overflow-hidden rounded-md bg-transparent outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        isClosedTask(task) && "text-muted-foreground",
      )}
    />
  );
}

// ── state lines ───────────────────────────────────────────────────────────────

/** "Done Oct 9 by Alex" (the completion record, call 77). */
function DoneLine({ task }: { task: Task }) {
  const { byId, currentUserId } = useAssignees();
  const by = task.completedBy
    ? task.completedBy === currentUserId
      ? "you"
      : ((byId(task.completedBy)?.fullName || byId(task.completedBy)?.name) ?? null)
    : null;
  const when = task.completedAt ? formatDate(task.completedAt) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted px-2 py-1.5 font-sans text-sm text-muted-foreground">
      <Check className="size-icon-sm shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Done{when ? ` ${when}` : ""}
        {by ? ` by ${by}` : ""}
      </span>
    </div>
  );
}

/**
 * A Won't do task reads as one, with Reopen right there (TV-P0, AC1.4):
 * Won't do ends a task without doing it, and it can always come back.
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
 * another task in its place, no title, no project, never "Inbox".
 */
export function PrivateItemPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
      <Lock className="size-icon text-muted-foreground" aria-hidden />
      <p className="font-display text-sm text-foreground">Private item</p>
      <p className="text-xs text-muted-foreground">
        Ask someone in its project to share it with you.
      </p>
      <Button variant="ghost" size="sm" className="mt-1" onClick={onBack}>
        Back to your tasks
      </Button>
    </div>
  );
}

/**
 * A task that is gone (TV-U13, research §12): the registry tells a deleted
 * one ("Deleted task" · who and when · Restore when you can edit) from one
 * you can't see ("Private item"). Anything else reads as private: nothing
 * about the task leaks either way.
 */
export function TaskGonePanel({
  taskId,
  api,
  canEdit,
  onBack,
}: {
  taskId: string;
  api: TasksModuleApi;
  canEdit: boolean;
  onBack: () => void;
}) {
  const state = useReference({ type: "task", id: taskId });
  const [deletion, setDeletion] = useState<ActivityEntry | null>(null);
  const { loadActivity, currentUserId } = api;
  const deleted = state?.status === "deleted";
  useEffect(() => {
    if (!deleted) return;
    let live = true;
    void loadActivity(taskId)
      .then((rows) => {
        if (live) setDeletion(rows.find((r) => r.op === "tasks.delete") ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [deleted, loadActivity, taskId]);
  if (!deleted) return <PrivateItemPanel onBack={onBack} />;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
      <Trash2 className="size-icon text-muted-foreground" aria-hidden />
      <p className="font-display text-sm text-foreground">Deleted task</p>
      {deletion ? (
        <p className="text-xs text-muted-foreground">
          {activityActorName(deletion, currentUserId)} deleted this · {feedTime(deletion.createdAt)}
        </p>
      ) : null}
      <div className="mt-1 flex gap-1">
        {canEdit ? (
          <Button variant="secondary" size="sm" onClick={() => void api.restoreTask(taskId)}>
            <RotateCcw aria-hidden />
            Restore
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back to your tasks
        </Button>
      </div>
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
      title="Select a task"
      description="↑↓ to move · ⏎ to open"
      hint={
        canEdit ? (
          <>
            Press <Kbd>c</Kbd> to {/* A link inside the sentence: a Button would break the line. */}
            <button
              type="button"
              onClick={() => onRequestCapture()}
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
