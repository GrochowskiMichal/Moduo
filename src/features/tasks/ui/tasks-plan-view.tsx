import {
  type CollisionDetection,
  closestCenter,
  closestCorners,
  DndContext,
  type DragEndEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { onCreateNew } from "../../../components/app/create-events";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { truncationNotice } from "../../../components/app/truncation-notice";
import { Button } from "../../../components/ui/button";
import { restoreNavFocus } from "../../../components/ui/nav-row";
import {
  asDragPayload,
  asDropLinkTarget,
  isSelfDrop,
  targetAccepts,
} from "../../../lib/drag-payload";
import type { EntityRef } from "../../../lib/entity-links";
import { ENTITY_OPEN_EVENT, takeEntityOpenIntent } from "../../../lib/entity-open";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { HubDropZone } from "../../contacts/ui/hub-drop-zone";
import { flushFocusSession, registerFocusFlushSink } from "../../focus/engine";
import { consumeFocusViewRequest, FOCUS_VIEW_REQUEST_EVENT } from "../../focus/view-request";
import { createLinkWithToast } from "../../spine/ui/drop-link-toast";
import { useAssignees } from "../assignees";
import {
  timeBlockByBucket as invertTimeBlocks,
  myTasksScope,
  openCount,
  resolveDefaultSelection,
  showsMyTasks,
} from "../default-view";
import { type GroupBy, groupsByBucket, taskMatchesTagFilter } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { isDrifted, type Task } from "../model";
import { resolveTasksDeepLink } from "../search";
import { sanitizeTimelineZoom, type TimelineZoom } from "../timeline-geometry";
import { BucketRail, parseCollapsedSections, type TasksMode } from "./bucket-rail";
import { CaptureModal } from "./capture-modal";
import { pointerFirstCollision, useTaskDndSensors } from "./dnd/task-dnd";
import { DriftTriageDialog } from "./drift-triage-dialog";
import { ExecuteView } from "./execute-view";
import { FrontierOfferDialog } from "./frontier-offer-dialog";
import type { PlanView } from "./plan-view-header";
import { type BoardGroupBy, TaskBoardView } from "./task-board-view";
import { TASK_DETAIL_REFRESH_EVENT, TaskDetailPanel } from "./task-detail-panel";
import { TaskListView } from "./task-list-view";
import { ActiveTagFilters, TagFilterButton } from "./task-tag-filter";
import { TaskTimelineView } from "./task-timeline-view";
import { useTasksDisplay } from "./use-tasks-display";

type Props = {
  api: TasksModuleApi;
  workspaceId: string;
  /** Spine runtime — powers the task detail panel's linked-entity hub (DF-8). */
  runtime: ModuoRuntime | null;
  /** URL-held task selection (?id=, DF-1) — the page owns the router coupling. */
  urlTaskId: string | null;
  onUrlTaskIdChange: (id: string | null) => void;
};

// The selection→URL mirror writes only at rest (see the mirror effect).
const URL_MIRROR_DEBOUNCE_MS = 250;

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

export function TasksPlanView({ api, workspaceId, runtime, urlTaskId, onUrlTaskIdChange }: Props) {
  const { canEdit, buckets, inbox, tasks } = api;

  const [mode, setMode] = useState<TasksMode>(() =>
    readLS(workspaceId, "mode") === "execute" ? "execute" : "plan",
  );
  const [view, setView] = useState<PlanView>(() => {
    const stored = readLS(workspaceId, "view");
    return stored === "board" || stored === "timeline" ? stored : "list";
  });
  // Provisional selection (last-opened bucket, never "all"); the time-block-aware
  // default is resolved once the bucket bundle has loaded (see effect below).
  const [selection, setSelection] = useState<string>(
    () => readLS(workspaceId, "lastBucket") ?? "inbox",
  );
  const [groupBy, setGroupBy] = useState<GroupBy>(
    () => (readLS(workspaceId, "groupBy") as GroupBy) ?? "none",
  );
  const [boardGroupBy, setBoardGroupBy] = useState<BoardGroupBy>(() =>
    readLS(workspaceId, "boardGroupBy") === "bucket" ? "bucket" : "status",
  );
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoom>(() =>
    sanitizeTimelineZoom(readLS(workspaceId, "timelineZoom")),
  );
  // Rail sections the user collapsed stay collapsed (tasks-v2 §11).
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(() =>
    parseCollapsedSections(readLS(workspaceId, "collapsedSections")),
  );
  const toggleSection = useCallback((name: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [triageBucketId, setTriageBucketId] = useState<string | null>(null);
  // Triage opens from a rail row and has no trigger to hand focus back to.
  const railNavRef = useRef<HTMLElement | null>(null);
  const triageFromRef = useRef<string | null>(null);
  // Queuing a blocked task offers its unblocked frontier first (spec §5c).
  const [frontierOfferTaskId, setFrontierOfferTaskId] = useState<string | null>(null);
  // Task-level selection (distinct from `selection`, which is the bucket scope).
  // Lifted here so the right-rail detail panel can bind to it across List/Board.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // DF-1 — URL sync bookkeeping. Selection is STATE mirrored into the URL —
  // not URL-derived like notes NO-3 — because this selection is a j/k
  // key-repeat cursor: it must not ride the router on every press, and WebKit
  // hard-throttles history.replaceState (~100/30s), so the mirror below is
  // debounced. Two refs discriminate who an id in the URL came from:
  // `processedUrlIdRef` marks ids this component already honored,
  // `selfWroteUrlIdRef` marks ids the mirror wrote itself. A `urlTaskId`
  // matching neither is an INBOUND deep link (widget row, contact rollup, note
  // chip, notification, refresh, back/forward). Two refs, not one: the
  // mirror's write commits to the router async, so a single marker would get
  // clobbered while the URL still holds the previous id — and background
  // bundle churn in that window would re-apply the OLD id as a fake deep
  // link. While an inbound id awaits its post-load apply, the selection
  // backstops must not steal it and the mirror must not overwrite it — all
  // gate on `inboundPending` (computed at render, so every effect in the
  // arrival flush sees the same verdict).
  const processedUrlIdRef = useRef<string | null>(null);
  const selfWroteUrlIdRef = useRef<string | null>(null);
  const scrollTargetRef = useRef<string | null>(null);
  const inboundPending =
    urlTaskId !== null &&
    processedUrlIdRef.current !== urlTaskId &&
    selfWroteUrlIdRef.current !== urlTaskId;
  // One-shot reveal request for the List view: expand a collapsed group ONCE
  // for a deep-link target — ordinary selection fallbacks never touch
  // collapse state (a group the user closes stays closed).
  const [revealRequest, setRevealRequest] = useState<{ id: string; seq: number } | null>(null);
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

  // DF-11 / TV-F1 — the app-level Focus engine saves tracked time through the
  // Tasks module's write path, so register `persistFocusTime` as this
  // workspace's sink while /tasks is mounted. A ref keeps the callback current
  // without re-registering (which would re-drain each render); registering
  // drains any backlog accrued while the module was unmounted, and the cleanup
  // banks accrued-so-far on navigation away.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });
  useEffect(
    () =>
      registerFocusFlushSink(workspaceId, (taskId, seconds, context) =>
        apiRef.current.persistFocusTime(taskId, seconds, context),
      ),
    [workspaceId],
  );
  // Once the bundle is loaded, drain any seconds the register-time flush had to
  // retain because it fired against the still-empty bundle on remount — so time
  // accrued while /tasks was unmounted actually lands (DF-11).
  useEffect(() => {
    if (!api.loading) flushFocusSession();
  }, [api.loading]);

  // The chrome chip's "open Focus" request → enter Execute mode. The one-shot
  // flag covers the fresh-mount case (chip clicked from another route, event
  // fired before this listener existed); the event covers the already-mounted
  // case (chip clicked while /tasks is open in Plan mode).
  useEffect(() => {
    if (consumeFocusViewRequest()) setMode("execute");
    // Consume the flag here too: the event fires synchronously inside
    // requestFocusView (before navigation), so an already-mounted /tasks clears
    // it now — otherwise a stale flag would force Execute on the next unrelated
    // /tasks visit that reaches the mount branch above.
    const onRequest = () => {
      consumeFocusViewRequest();
      setMode("execute");
    };
    window.addEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
  }, []);

  // Persist preferences.
  useEffect(() => writeLS(workspaceId, "mode", mode), [workspaceId, mode]);
  useEffect(() => writeLS(workspaceId, "view", view), [workspaceId, view]);
  useEffect(() => writeLS(workspaceId, "groupBy", groupBy), [workspaceId, groupBy]);
  useEffect(() => writeLS(workspaceId, "boardGroupBy", boardGroupBy), [workspaceId, boardGroupBy]);
  useEffect(() => writeLS(workspaceId, "timelineZoom", timelineZoom), [workspaceId, timelineZoom]);
  useEffect(
    () => writeLS(workspaceId, "collapsedSections", JSON.stringify([...collapsedSections])),
    [workspaceId, collapsedSections],
  );

  // Remember the last concrete bucket scope (never "all" / "mine" / "today") so
  // the next open can land back on it (spec §9.2).
  useEffect(() => {
    if (selection === "all" || selection === "mine" || selection === "today") return;
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
    // DF-1: an inbound deep link owns the entry scope — skip the time-block/
    // last-bucket default rather than race the apply effect below for it
    // (both would queue setSelection in the same flush; the default must not
    // win over the deep link's bucket).
    if (inboundPending) {
      resolvedForRef.current = workspaceId;
      return;
    }
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
  }, [api.loading, workspaceId, inboxId, buckets, timeBlocks, inboundPending]);

  // "My tasks" is only in the rail of workspaces with two or more members
  // (tasks-v2 §1): with fewer, every task is yours, so All says the same.
  const { assignees, currentUserId } = useAssignees();
  const showMyTasks = showsMyTasks(assignees.length);

  // Keep selection valid; "inbox" resolves against the seeded Inbox bucket.
  useEffect(() => {
    if (selection === "all" || selection === "inbox" || selection === "today") return;
    if (selection === "mine") {
      // Members load with the workspace; wait for them before ruling.
      if (!showMyTasks && assignees.length > 0) setSelection("inbox");
      return;
    }
    if (inboxId && selection === inboxId) return;
    if (!buckets.some((b) => b.id === selection)) setSelection("inbox");
  }, [selection, buckets, inboxId, showMyTasks, assignees.length]);

  // All and My tasks imply bucket grouping in List; a single bucket flattens
  // it. Nudge groupBy on scope changes so the control stays meaningful (user
  // can override).
  const isAll = groupsByBucket(selection);
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
    if (selection === "today") return api.queuedTasks;
    if (selection === "all") return tasks.filter((t) => t.status !== "archived");
    if (selection === "mine") return myTasksScope(tasks, currentUserId);
    const bucketId = selection === "inbox" ? inboxId : selection;
    if (!bucketId) return [];
    return tasks.filter((t) => t.bucketId === bucketId && t.status !== "archived");
  }, [selection, tasks, inboxId, api.queuedTasks, currentUserId]);

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
    selection === "all"
      ? "All"
      : selection === "mine"
        ? "My tasks"
        : selection === "today"
          ? "Queue"
          : selection === "inbox"
            ? "Inbox"
            : bucketNameById(selection);

  // The Queue is one ordered line-up, so its List view is never grouped.
  const effectiveGroupBy = selection === "today" ? "none" : groupBy;

  // Where a captured task lands: the selected bucket, else Inbox.
  const captureBucketId =
    isAll || selection === "today" ? inboxId : selection === "inbox" ? inboxId : selection;

  const totalOpenCount = useMemo(
    () => tasks.filter((t) => t.status !== "done" && t.status !== "archived").length,
    [tasks],
  );
  const myOpenCount = useMemo(
    () => (showMyTasks ? openCount(myTasksScope(tasks, currentUserId)) : 0),
    [showMyTasks, tasks, currentUserId],
  );

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

  // ── blocked-by: frontier offer on queuing (spec §5c) ────────────────────────
  // One interception point for every queue affordance (row/card toggles and
  // context menus, detail panel, list keyboard): queuing a *blocked* task opens
  // the quiet frontier dialog instead — with "Queue anyway" as the escape hatch
  // (never a wall). Removing from the queue always goes straight through.
  const guardedToggleQueue = useCallback(
    (id: string) => {
      if (
        !api.queuedTaskIds.has(id) &&
        api.blockedTaskIds.has(id) &&
        api.frontierFor(id).length > 0
      ) {
        setFrontierOfferTaskId(id);
        return;
      }
      api.toggleQueue(id);
    },
    [api],
  );
  // The views see the guarded toggle through an otherwise-unchanged api facade.
  const viewApi = useMemo<TasksModuleApi>(
    () => ({ ...api, toggleQueue: guardedToggleQueue }),
    [api, guardedToggleQueue],
  );

  const frontierOfferTask = useMemo(
    () => (frontierOfferTaskId ? (tasks.find((t) => t.id === frontierOfferTaskId) ?? null) : null),
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
      taskCountByBucket={api.taskCountByBucket}
      driftCountByBucket={api.driftCountByBucket}
      totalOpenCount={totalOpenCount}
      queueCount={api.queueCount}
      myTasksCount={showMyTasks ? myOpenCount : null}
      canEdit={canEdit}
      onCreateBucket={api.createBucket}
      onRenameBucket={api.renameBucket}
      onDeleteBucket={api.deleteBucket}
      onTriageBucket={(id) => {
        triageFromRef.current = id;
        setTriageBucketId(id);
      }}
      timeBlockByBucket={timeBlocksByBucket}
      onSetTimeBlock={api.setTimeBlock}
      onSetBucketGroup={api.setBucketGroup}
      collapsedSections={collapsedSections}
      onToggleSection={toggleSection}
      navRef={railNavRef}
    />
  );

  // Display (tasks-v2 §7): Completed + "Show on rows", remembered per
  // workspace and scope on this device; a task checked off or opened here
  // stays listed until the scope changes (TV-U1). TV-U2 adds the rest.
  const tasksDisplay = useTasksDisplay(workspaceId, selection, tasks, selectedTaskId);
  const isHiddenByDisplay = tasksDisplay.isHidden;

  // Resolve the selected task live from the bundle so the rail follows edits and
  // empties when the task is deleted.
  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? null) : null),
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
    if (api.loading || inboundPending) return;
    if (selectedTaskId && scopeTasks.some((t) => t.id === selectedTaskId)) return;
    if (selectedTask?.parentId && scopeTasks.some((t) => t.id === selectedTask.parentId)) return;
    // Never a completed task Display hides (TV-U1): the Board has no
    // fallback of its own, so it would open the panel on a card it doesn't show.
    setSelectedTaskId(scopeTasks.find((t) => !isHiddenByDisplay(t))?.id ?? null);
  }, [api.loading, inboundPending, selectedTaskId, selectedTask, scopeTasks, isHiddenByDisplay]);

  // ── DF-1: URL-held selection ─────────────────────────────────────────────────
  // Inbound apply — honor a deep-link target once the bundle is CLEANLY loaded
  // (a failed fetch leaves an empty bundle with api.error set; resolving
  // against that would wrongly strip a valid id — hold until Retry succeeds).
  // A fresh external open (marked by the app-chrome listener) gets the full
  // "take me there" treatment: plan mode + tag filter cleared if it hides the
  // target. A mirrored id arriving back on refresh/back-forward restores the
  // selection quietly and keeps the user's mode/filter. Scope snaps to the
  // task's bucket unless the current scope already shows it. A bucket id (a
  // `project` link) scopes the rail; a stale or archived id clears quietly and
  // the backstop above picks the default (AC: no crash).
  useEffect(() => {
    if (api.loading || api.error) return;
    if (!urlTaskId) {
      processedUrlIdRef.current = null;
      return;
    }
    if (processedUrlIdRef.current === urlTaskId) return;
    if (selfWroteUrlIdRef.current === urlTaskId) {
      processedUrlIdRef.current = urlTaskId;
      return;
    }
    processedUrlIdRef.current = urlTaskId;
    const external = takeEntityOpenIntent(urlTaskId);
    // Archived tasks are invisible in every scope — selecting one would just
    // feed the backstop a random replacement; treat like a stale id instead.
    const target = resolveTasksDeepLink(urlTaskId, {
      tasks: tasks.filter((t) => t.status !== "archived"),
      buckets,
      inboxId,
    });
    if (target.kind === "none") {
      onUrlTaskIdChange(null);
      return;
    }
    if (external) setMode("plan");
    if (target.kind === "bucket") {
      setSelection(target.scope);
      // Hand the URL to the backstop's fresh pick — the mirror must not
      // re-publish the previous scope's selection over the project link.
      setSelectedTaskId(null);
      return;
    }
    if (external) {
      const targetTagIds = (api.tagsByTask.get(target.taskId) ?? []).map((t) => t.id);
      if (liveFilterTagIds.length > 0 && !taskMatchesTagFilter(targetTagIds, liveFilterTagIds)) {
        setFilterTagIds([]);
      }
    }
    if (!scopeTasksAll.some((t) => t.id === target.taskId)) setSelection(target.scope);
    setSelectedTaskId(target.taskId);
    setRevealRequest((prev) => ({ id: target.taskId, seq: (prev?.seq ?? 0) + 1 }));
    scrollTargetRef.current = target.taskId;
  }, [
    api.loading,
    api.error,
    api.tagsByTask,
    urlTaskId,
    tasks,
    buckets,
    inboxId,
    liveFilterTagIds,
    scopeTasksAll,
    onUrlTaskIdChange,
  ]);

  // Mirror selection → URL (replace) so refresh keeps it. Trailing-debounced:
  // the URL only needs to be right at rest, and WebKit throttles
  // history.replaceState (~100 calls/30s) — an undebounced j/k key-repeat
  // cursor would trip a SecurityError in the desktop webview. Suspended while
  // an inbound id awaits apply — never overwrite a target before honoring it.
  useEffect(() => {
    if (api.loading || inboundPending) return;
    if ((selectedTaskId ?? null) === (urlTaskId ?? null)) return;
    const handle = window.setTimeout(() => {
      selfWroteUrlIdRef.current = selectedTaskId;
      onUrlTaskIdChange(selectedTaskId);
    }, URL_MIRROR_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [api.loading, inboundPending, selectedTaskId, urlTaskId, onUrlTaskIdChange]);

  // Reveal the deep-linked row/card/bar once it exists in the DOM — the scope
  // snap, a collapsed group's reveal, and a nested subtask's parent
  // auto-expand settle over a few frames, so poll briefly instead of assuming
  // one. Instant scroll: a programmatic reveal, not an animation. `inline`
  // reveals horizontally too (the Timeline canvas scrolls sideways).
  useEffect(() => {
    const id = scrollTargetRef.current;
    if (!id || api.loading) return;
    scrollTargetRef.current = null;
    let tries = 0;
    const reveal = () => {
      const el = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", inline: "center" });
        return;
      }
      if (++tries < 24) requestAnimationFrame(reveal);
    };
    requestAnimationFrame(reveal);
  }, [api.loading, urlTaskId]);

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
    api: viewApi,
  };
  // List and Board follow Display; the Timeline keeps its own rules.
  const displayProps = tasksDisplay.viewProps;

  // Execute mode is enclosed in the center panel (rails stay visible).
  const body =
    mode === "execute" ? (
      <ExecuteView
        workspaceId={workspaceId}
        queuedTasks={api.queuedTasks}
        bucketNameById={bucketNameById}
        parentTitleFor={parentTitleFor}
        blockedNoteFor={blockedNoteFor}
        onMarkDone={api.markDone}
        onSkip={api.moveQueuedToEnd}
        onAddTime={(taskId, seconds) => void api.logTimeAdjustment(taskId, seconds)}
        onSetTime={api.setTimeSpent}
        tagsFor={(id) => api.tagsByTask.get(id) ?? []}
        subtasksFor={(id) => api.subtasksByParent.get(id) ?? []}
        onToggleSubtask={api.toggleDone}
        onExit={exitExecute}
        loading={api.loading}
        canEdit={canEdit}
        onCaptureToQueue={api.captureToQueue}
      />
    ) : view === "board" ? (
      <TaskBoardView
        {...sharedViewProps}
        {...displayProps}
        dndMode="external"
        boardGroupBy={boardGroupBy}
        onBoardGroupByChange={setBoardGroupBy}
      />
    ) : view === "timeline" ? (
      <TaskTimelineView {...sharedViewProps} zoom={timelineZoom} onZoomChange={setTimelineZoom} />
    ) : (
      <TaskListView
        {...sharedViewProps}
        {...displayProps}
        dndMode="external"
        groupBy={effectiveGroupBy}
        onGroupByChange={setGroupBy}
        reorderable={selection === "today"}
        onReorder={api.reorderQueue}
        nestable={selection !== "today" && !groupsByBucket(selection)}
        revealRequest={revealRequest}
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

  // ── DF-22: one app-level DndContext across the whole shell ──────────────────
  // Unifies the center views' reorder/nest with the right-pane hub (DF-8 shipped
  // the hub as a ready-but-sourceless drop target) so a task dragged from the
  // List or Board can be dropped on the selected task's hub to link it. The List
  // & Board render as `useDndMonitor` consumers (dndMode="external", the NO-7b
  // pattern); the Timeline keeps its OWN nested context — its tray→axis drag
  // needs autoScroll off and a keyboard-disabled, pointer-derived drop that
  // genuinely conflict with a shared context, and it has no cross-pane drop
  // target (bars are custom pointer engines, not dnd-kit). Nested = the inner
  // timeline context claims tray drags, so the hub handler never sees them.
  const pageSensors = useTaskDndSensors();
  // Refs so the collision fn (stable, empty-deps) always reads the live surface;
  // neither can change mid-drag (switching view/scope remounts the body).
  const viewRef = useRef(view);
  const selectionRef = useRef(selection);
  useEffect(() => {
    viewRef.current = view;
    selectionRef.current = selection;
  });
  // One collision for every surface: the hub (a `link:*` droppable) wins whenever
  // the pointer is actually over it; otherwise each center view keeps its OWN
  // native strategy over its OWN droppables (link targets filtered out, so a card
  // dragged toward the right pane never mis-resolves to the hub by corner
  // distance). The three center strategies must match the internal-mode contexts
  // byte-for-byte: Board = closestCorners; Queue reorder = closestCenter (NOT
  // pointer-first — the whole row is the drag activator, so an off-center grab
  // makes the dragged-rect-centre and the pointer diverge, changing the drop
  // index); drag-onto-task nest = pointer-first (an expanded parent's `onto-task`
  // rect is taller than its row, so pointerWithin is required for precision).
  const appCollision = useCallback<CollisionDetection>((args) => {
    const linkContainers = args.droppableContainers.filter((c) => String(c.id).startsWith("link:"));
    if (linkContainers.length > 0) {
      const hubHits = pointerWithin({ ...args, droppableContainers: linkContainers });
      if (hubHits.length > 0) return hubHits;
    }
    const centerContainers = args.droppableContainers.filter(
      (c) => !String(c.id).startsWith("link:"),
    );
    const strategy =
      viewRef.current === "board"
        ? closestCorners
        : selectionRef.current === "today"
          ? closestCenter // the Queue's reorder — mirrors the internal-mode context
          : pointerFirstCollision; // nest (and inert grouped list)
    return strategy({ ...args, droppableContainers: centerContainers });
  }, []);

  // Opening a linked task selects it in place; other entity types deep-link out.
  const handleOpenEntity = useCallback(
    (ref: EntityRef) => {
      if (ref.type === "task") {
        // Route through the DF-1 deep-link path (URL ?id=), not a raw
        // setSelectedTaskId: a linked task may live outside the current bucket
        // scope (spine links cross buckets), and the scope-validity backstop
        // would bounce a raw selection back to the first in-scope task. The
        // inbound-apply effect snaps scope to the target's bucket first.
        onUrlTaskIdChange(ref.id);
        return;
      }
      window.dispatchEvent(
        new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: ref.type, id: ref.id } }),
      );
    },
    [onUrlTaskIdChange],
  );
  const onHubDragEnd = useCallback(
    (event: DragEndEvent) => {
      const payload = asDragPayload(event.active.data.current);
      const target = asDropLinkTarget(event.over?.data.current);
      if (!payload || !target) return;
      if (!runtime || !canEdit) return;
      if (isSelfDrop(payload, target)) {
        toast("You can’t link a task to itself");
        return;
      }
      if (!targetAccepts(target, payload)) return;
      void (async () => {
        // Guard a pre-existing edge: a fresh Undo toast on an already-linked pair
        // would delete a link the user didn't make in THIS gesture (FX-9 parity).
        try {
          const links = await runtime.spine.listLinks({
            workspaceId,
            entityType: target.entityType,
            entityId: target.entityId,
          });
          const already = links.some(
            (l) =>
              (l.sourceType === payload.entityType && l.sourceId === payload.entityId) ||
              (l.targetType === payload.entityType && l.targetId === payload.entityId),
          );
          if (already) {
            toast("Already linked");
            return;
          }
        } catch {
          // a failed pre-check must not block a legitimate link
        }
        await createLinkWithToast({
          runtime,
          workspaceId,
          source: payload,
          target,
          origin: "drag",
          onChanged: () => window.dispatchEvent(new CustomEvent(TASK_DETAIL_REFRESH_EVENT)),
        });
      })();
    },
    [runtime, workspaceId, canEdit],
  );

  const detailPanel = (
    <TaskDetailPanel
      task={selectedTask}
      buckets={buckets}
      inbox={inbox}
      canEdit={canEdit}
      onRequestCapture={openCapture}
      onSelectTask={setSelectedTaskId}
      api={viewApi}
      runtime={runtime}
      workspaceId={workspaceId}
      onOpenEntity={handleOpenEntity}
    />
  );
  // The hub is a drop target within the ONE page-level DndContext (below); no
  // own context — that's exactly what let center rows reach it (DF-22).
  const right = selectedTask ? (
    <HubDropZone target={{ type: "task", id: selectedTask.id }} disabled={!canEdit}>
      {detailPanel}
    </HubDropZone>
  ) : (
    detailPanel
  );

  return (
    <>
      <DndContext sensors={pageSensors} collisionDetection={appCollision} onDragEnd={onHubDragEnd}>
        <FeaturePanelsShell
          feature="tasks"
          notice={truncationNotice(api.truncated)}
          left={left}
          center={center}
          right={right}
        />
      </DndContext>
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
        onCloseAutoFocus={(event) =>
          restoreNavFocus(event, railNavRef.current, triageFromRef.current)
        }
      />
      <FrontierOfferDialog
        open={frontierOfferTaskId !== null}
        onOpenChange={(o) => !o && setFrontierOfferTaskId(null)}
        task={frontierOfferTask}
        frontier={frontierOffer}
        bucketNameById={bucketNameById}
        onQueueTask={api.addToQueue}
        onQueueAnyway={() => {
          if (frontierOfferTaskId) api.addToQueue(frontierOfferTaskId);
        }}
      />
    </>
  );
}
