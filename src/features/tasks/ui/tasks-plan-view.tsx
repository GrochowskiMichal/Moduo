import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { onCreateNew } from "../../../components/app/create-events";
import { Button } from "../../../components/ui/button";
import {
  resolveDefaultSelection,
  timeBlockByBucket as invertTimeBlocks,
} from "../default-view";
import { taskMatchesTagFilter, type GroupBy } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { isDrifted, type Task } from "../model";
import { BucketRail, type TasksMode } from "./bucket-rail";
import { CaptureModal } from "./capture-modal";
import { DriftTriageDialog } from "./drift-triage-dialog";
import { ExecuteView } from "./execute-view";
import { FrontierOfferDialog } from "./frontier-offer-dialog";
import type { PlanView } from "./plan-view-header";
import { TaskBoardView, type BoardGroupBy } from "./task-board-view";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskListView } from "./task-list-view";
import { ActiveTagFilters, TagFilterButton } from "./task-tag-filter";

type Props = {
  api: TasksModuleApi;
  workspaceId: string;
};

// Per-workspace UI state (selection / mode / view / grouping) persisted locally —
// these are view preferences, not synced data.
function lsKey(workspaceId: string, part: string): string {
  return `moduo:tasks:${part}:${workspaceId}`;
}
function readLS(workspaceId: string, part: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(lsKey(workspaceId, part));
  } catch {
    return null;
  }
}
function writeLS(workspaceId: string, part: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lsKey(workspaceId, part), value);
  } catch {
    /* ignore */
  }
}

export function TasksPlanView({ api, workspaceId }: Props) {
  const { canEdit, buckets, inbox, tasks } = api;

  const [mode, setMode] = useState<TasksMode>(
    () => (readLS(workspaceId, "mode") === "execute" ? "execute" : "plan"),
  );
  const [view, setView] = useState<PlanView>(
    () => (readLS(workspaceId, "view") === "board" ? "board" : "list"),
  );
  // Provisional selection (last-opened bucket, never "all"); the time-block-aware
  // default is resolved once the bucket bundle has loaded (see effect below).
  const [selection, setSelection] = useState<string>(
    () => readLS(workspaceId, "lastBucket") ?? "inbox",
  );
  const [groupBy, setGroupBy] = useState<GroupBy>(
    () => (readLS(workspaceId, "groupBy") as GroupBy) ?? "none",
  );
  const [boardGroupBy, setBoardGroupBy] = useState<BoardGroupBy>(
    () => (readLS(workspaceId, "boardGroupBy") === "bucket" ? "bucket" : "status"),
  );
  const [captureOpen, setCaptureOpen] = useState(false);
  const [triageBucketId, setTriageBucketId] = useState<string | null>(null);
  // Committing a blocked task offers its unblocked frontier first (spec §5c).
  const [frontierOfferTaskId, setFrontierOfferTaskId] = useState<string | null>(null);
  // Task-level selection (distinct from `selection`, which is the bucket scope).
  // Lifted here so the right-rail detail panel can bind to it across List/Board.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Tag filter — narrows the center list/board (rail counts stay whole). Held in
  // memory (a transient view state, not a persisted preference); reset per
  // workspace so a filter never bleeds across workspaces.
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  useEffect(() => setFilterTagIds([]), [workspaceId]);
  const toggleTagFilter = useCallback(
    (tagId: string) =>
      setFilterTagIds((prev) =>
        prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
      ),
    [],
  );
  // Only filter by ids that still resolve to a live tag. A tag deleted while in
  // the filter (or an optimistic `tmp-` id captured by a chip click that's since
  // been reconciled to a real id) would otherwise apply forever — hiding every
  // task with no chip/Clear to recover. Reading the derived set everywhere keeps
  // the raw state harmless; it's pruned lazily on the next toggle/clear.
  const liveFilterTagIds = useMemo(() => {
    if (filterTagIds.length === 0) return filterTagIds;
    const live = new Set(api.tags.map((t) => t.id));
    return filterTagIds.filter((id) => live.has(id));
  }, [filterTagIds, api.tags]);

  // Persist preferences.
  useEffect(() => writeLS(workspaceId, "mode", mode), [workspaceId, mode]);
  useEffect(() => writeLS(workspaceId, "view", view), [workspaceId, view]);
  useEffect(() => writeLS(workspaceId, "groupBy", groupBy), [workspaceId, groupBy]);
  useEffect(() => writeLS(workspaceId, "boardGroupBy", boardGroupBy), [workspaceId, boardGroupBy]);

  // Remember the last concrete bucket scope (never "all" / "today") so the next
  // open can land back on it (spec §9.2).
  useEffect(() => {
    if (selection === "all" || selection === "today") return;
    writeLS(workspaceId, "lastBucket", selection);
  }, [workspaceId, selection]);

  // Time-blocks are workspace data, loaded with the bundle (api.timeBlocks).
  const timeBlocks = api.timeBlocks;

  const inboxId = inbox?.id ?? null;

  // Default-view resolution (spec §9), run once per workspace after the bundle
  // loads: time-block bucket → last-opened bucket → Inbox. Never the full list.
  const resolvedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (api.loading) return;
    if (resolvedForRef.current === workspaceId) return;
    resolvedForRef.current = workspaceId;
    const bucketIds = [inboxId, ...buckets.map((b) => b.id)].filter(Boolean) as string[];
    setSelection(
      resolveDefaultSelection({
        timeBlocks,
        lastBucket: readLS(workspaceId, "lastBucket"),
        bucketIds,
        inboxId,
      }),
    );
  }, [api.loading, workspaceId, inboxId, buckets, timeBlocks]);

  // Keep selection valid; "inbox" resolves against the seeded Inbox bucket.
  useEffect(() => {
    if (selection === "all" || selection === "inbox" || selection === "today") return;
    if (inboxId && selection === inboxId) return;
    if (!buckets.some((b) => b.id === selection)) setSelection("inbox");
  }, [selection, buckets, inboxId]);

  // "All" implies bucket grouping in List; a single bucket flattens it. Nudge
  // groupBy on scope changes so the control stays meaningful (user can override).
  const isAll = selection === "all";
  useEffect(() => {
    if (isAll && groupBy === "none") setGroupBy("bucket");
    if (!isAll && groupBy === "bucket") setGroupBy("none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAll]);

  const bucketNameById = useCallback(
    (id: string) => {
      if (inbox && id === inbox.id) return "Inbox";
      return buckets.find((b) => b.id === id)?.name ?? "Inbox";
    },
    [buckets, inbox],
  );

  const scopeTasksAll = useMemo(() => {
    if (selection === "today") return api.committedTasks;
    if (selection === "all") return tasks.filter((t) => t.status !== "archived");
    const bucketId = selection === "inbox" ? inboxId : selection;
    if (!bucketId) return [];
    return tasks.filter((t) => t.bucketId === bucketId && t.status !== "archived");
  }, [selection, tasks, inboxId, api.committedTasks]);

  // Apply the tag filter on top of the bucket scope (center only; rail counts
  // stay whole). OR/union — a task matches if it carries any selected tag.
  const scopeTasks = useMemo(() => {
    if (liveFilterTagIds.length === 0) return scopeTasksAll;
    return scopeTasksAll.filter((t) =>
      taskMatchesTagFilter(
        (api.tagsByTask.get(t.id) ?? []).map((tag) => tag.id),
        liveFilterTagIds,
      ),
    );
  }, [scopeTasksAll, liveFilterTagIds, api.tagsByTask]);

  const scopeTitle =
    isAll ? "All" : selection === "today" ? "Queue" : selection === "inbox" ? "Inbox" : bucketNameById(selection);

  // The commit queue is inherently ordered, so Today List view is never grouped.
  const effectiveGroupBy = selection === "today" ? "none" : groupBy;

  // Where a captured task lands: the selected bucket, else Inbox.
  const captureBucketId =
    isAll || selection === "today" ? inboxId : selection === "inbox" ? inboxId : selection;

  const totalOpenCount = useMemo(
    () => tasks.filter((t) => t.status !== "done" && t.status !== "archived").length,
    [tasks],
  );
  const committedCount = api.committedTasks.length;

  const timeBlocksByBucket = useMemo(() => invertTimeBlocks(timeBlocks), [timeBlocks]);

  // Drifted tasks for the bucket currently being triaged (recomputed live so the
  // dialog empties as the user triages).
  const driftTasks = useMemo(() => {
    if (!triageBucketId) return [];
    const now = new Date();
    return tasks.filter((t) => t.bucketId === triageBucketId && isDrifted(t, now));
  }, [triageBucketId, tasks]);

  const openCapture = useCallback(() => {
    if (canEdit) setCaptureOpen(true);
  }, [canEdit]);

  // cmd+n / global "+" → capture (this listener is only mounted on /tasks).
  useEffect(() => onCreateNew(openCapture), [openCapture]);

  const exitExecute = useCallback(() => setMode("plan"), []);

  // ── blocked-by: frontier offer on commit (spec §5c) ─────────────────────────
  // One interception point for every commit affordance (row/card context menus,
  // detail panel, list keyboard): committing a *blocked* task opens the quiet
  // frontier dialog instead — with "Commit anyway" as the escape hatch (never a
  // wall). Removing from Today always goes straight through.
  const guardedToggleCommit = useCallback(
    (id: string) => {
      const task = tasks.find((t) => t.id === id);
      if (
        task &&
        task.committedFor !== api.today &&
        api.blockedTaskIds.has(id) &&
        api.frontierFor(id).length > 0
      ) {
        setFrontierOfferTaskId(id);
        return;
      }
      api.toggleCommit(id);
    },
    [tasks, api],
  );
  // The views see the guarded commit through an otherwise-unchanged api facade.
  const viewApi = useMemo<TasksModuleApi>(
    () => ({ ...api, toggleCommit: guardedToggleCommit }),
    [api, guardedToggleCommit],
  );

  const frontierOfferTask = useMemo(
    () => (frontierOfferTaskId ? tasks.find((t) => t.id === frontierOfferTaskId) ?? null : null),
    [frontierOfferTaskId, tasks],
  );
  const frontierOffer = useMemo(
    () => (frontierOfferTaskId ? api.frontierFor(frontierOfferTaskId) : []),
    [frontierOfferTaskId, api],
  );

  // Quiet "waiting on …" note for blocked tasks in Execute (mirror, not a wall —
  // a committed-anyway task stays fully actionable).
  const blockedNoteFor = useCallback(
    (task: Task) => {
      if (!api.blockedTaskIds.has(task.id)) return null;
      const open = (api.blockersByTask.get(task.id) ?? []).filter(
        (b) => b.status !== "done" && b.status !== "archived",
      );
      if (open.length === 0) return null;
      return open.length === 1
        ? `Waiting on “${open[0].title || "Untitled"}”`
        : `Waiting on ${open.length} tasks`;
    },
    [api],
  );

  // Quiet "↳ parent" context for committed subtasks in the Execute queue.
  const parentTitleFor = useCallback(
    (task: { parentId: string | null }) => {
      if (!task.parentId) return null;
      const parent = tasks.find((t) => t.id === task.parentId);
      return parent ? parent.title || "Untitled" : null;
    },
    [tasks],
  );

  const left = (
    <BucketRail
      mode={mode}
      onModeChange={setMode}
      selection={selection}
      onSelect={setSelection}
      buckets={buckets}
      inbox={inbox}
      openCountByBucket={api.openTaskCountByBucket}
      driftCountByBucket={api.driftCountByBucket}
      totalOpenCount={totalOpenCount}
      committedCount={committedCount}
      canEdit={canEdit}
      onCreateBucket={api.createBucket}
      onRenameBucket={api.renameBucket}
      onDeleteBucket={api.deleteBucket}
      onTriageBucket={setTriageBucketId}
      timeBlockByBucket={timeBlocksByBucket}
      onSetTimeBlock={api.setTimeBlock}
      onSetBucketGroup={api.setBucketGroup}
    />
  );

  // Resolve the selected task live from the bundle so the rail follows edits and
  // empties when the task is deleted.
  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks],
  );

  // Scope-level selection validity (the state lives here, so its backstop does
  // too): when the selected task leaves the scope (archived, moved, deleted,
  // scope/workspace switch), fall back to the first task in scope. The List view
  // refines this against its collapse-aware visible rows; Board has no own logic
  // and relies on this entirely. A subtask whose *parent* is in scope also
  // counts as in-scope — it can be selected from under the parent (expanded
  // list rows, the detail panel's subtask list) even from another bucket.
  useEffect(() => {
    if (api.loading) return;
    if (selectedTaskId && scopeTasks.some((t) => t.id === selectedTaskId)) return;
    if (selectedTask?.parentId && scopeTasks.some((t) => t.id === selectedTask.parentId)) return;
    setSelectedTaskId(scopeTasks[0]?.id ?? null);
  }, [api.loading, selectedTaskId, selectedTask, scopeTasks]);

  // Tag-filter header control + active-chip row, passed to both views as nodes so
  // List/Board stay unaware of the filter machinery.
  const tagFilterControl =
    api.tags.length > 0 ? (
      <TagFilterButton
        tags={api.tags}
        filterTagIds={liveFilterTagIds}
        countByTag={api.openTaskCountByTag}
        onToggle={toggleTagFilter}
      />
    ) : undefined;
  const activeTagFilters =
    liveFilterTagIds.length > 0 ? (
      <ActiveTagFilters
        tags={api.tags}
        filterTagIds={liveFilterTagIds}
        matchCount={scopeTasks.length}
        scopeCount={scopeTasksAll.length}
        onToggle={toggleTagFilter}
        onClear={() => setFilterTagIds([])}
      />
    ) : undefined;

  const sharedViewProps = {
    tasks: scopeTasks,
    scopeTitle,
    selection,
    view,
    onViewChange: setView,
    buckets,
    inbox,
    bucketNameById,
    canEdit,
    onRequestCapture: openCapture,
    selectedTaskId,
    onSelectTask: setSelectedTaskId,
    tagFilterControl,
    activeTagFilters,
    onTagFilter: toggleTagFilter,
    api: viewApi,
  };

  // Execute mode is enclosed in the center panel (rails stay visible).
  const body =
    mode === "execute" ? (
      <ExecuteView
        committedTasks={api.committedTasks}
        bucketNameById={bucketNameById}
        parentTitleFor={parentTitleFor}
        blockedNoteFor={blockedNoteFor}
        onMarkDone={api.markDone}
        onSkip={api.rescheduleFromToday}
        onAddTime={api.addTimeSpent}
        onSetTime={api.setTimeSpent}
        tagsFor={(id) => api.tagsByTask.get(id) ?? []}
        subtasksFor={(id) => api.subtasksByParent.get(id) ?? []}
        onToggleSubtask={api.toggleDone}
        onExit={exitExecute}
      />
    ) : view === "board" ? (
      <TaskBoardView
        {...sharedViewProps}
        boardGroupBy={boardGroupBy}
        onBoardGroupByChange={setBoardGroupBy}
      />
    ) : (
      <TaskListView
        {...sharedViewProps}
        groupBy={effectiveGroupBy}
        onGroupByChange={setGroupBy}
        reorderable={selection === "today"}
        onReorder={api.reorderQueue}
      />
    );

  // The hosted Supabase project may not have the tasks tables yet (web only).
  const notMigrated = /schema cache|could not find the table|does not exist/i.test(api.error ?? "");
  const center = (
    <div className="flex h-full min-h-0 flex-col">
      {api.error ? (
        <div className="mb-3 flex shrink-0 items-start justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 font-sans text-muted-foreground">
            {notMigrated
              ? "Tasks aren’t set up on this database yet — apply the Supabase migrations, or use the desktop app."
              : `Couldn’t load tasks: ${api.error}`}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={api.loading}
            onClick={() => void api.reload()}
          >
            {api.loading ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );

  const right = (
    <TaskDetailPanel
      task={selectedTask}
      buckets={buckets}
      inbox={inbox}
      canEdit={canEdit}
      onRequestCapture={openCapture}
      onSelectTask={setSelectedTaskId}
      api={viewApi}
    />
  );

  return (
    <>
      <FeaturePanelsShell feature="tasks" left={left} center={center} right={right} />
      <CaptureModal
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        buckets={buckets}
        inbox={inbox}
        defaultBucketId={captureBucketId}
        onCreate={api.createTask}
      />
      <DriftTriageDialog
        open={triageBucketId !== null}
        onOpenChange={(o) => !o && setTriageBucketId(null)}
        bucketName={triageBucketId ? bucketNameById(triageBucketId) : ""}
        tasks={driftTasks}
        canEdit={canEdit}
        onReschedule={(id, days) => api.rescheduleScheduledAt(id, days)}
        onArchive={api.archiveTask}
        onIgnore={api.unscheduleTask}
      />
      <FrontierOfferDialog
        open={frontierOfferTaskId !== null}
        onOpenChange={(o) => !o && setFrontierOfferTaskId(null)}
        task={frontierOfferTask}
        frontier={frontierOffer}
        bucketNameById={bucketNameById}
        onCommitTask={api.toggleCommit}
        onCommitAnyway={() => {
          if (frontierOfferTaskId) api.toggleCommit(frontierOfferTaskId);
        }}
      />
    </>
  );
}
