import { useCallback, useEffect, useMemo, useState } from "react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { onCreateNew } from "../../../components/app/create-events";
import { Button } from "../../../components/ui/button";
import type { GroupBy } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { BucketRail, type TasksMode } from "./bucket-rail";
import { CaptureModal } from "./capture-modal";
import { ExecuteView } from "./execute-view";
import { TaskListView } from "./task-list-view";

type Props = {
  api: TasksModuleApi;
  workspaceId: string;
};

// Per-workspace UI state (selection / mode / grouping) persisted locally — these
// are view preferences, not synced data.
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
  const [selection, setSelection] = useState<string>(
    () => readLS(workspaceId, "selection") ?? "inbox",
  );
  const [groupBy, setGroupBy] = useState<GroupBy>(
    () => (readLS(workspaceId, "groupBy") as GroupBy) ?? "none",
  );
  const [captureOpen, setCaptureOpen] = useState(false);

  // Persist preferences.
  useEffect(() => writeLS(workspaceId, "mode", mode), [workspaceId, mode]);
  useEffect(() => writeLS(workspaceId, "selection", selection), [workspaceId, selection]);
  useEffect(() => writeLS(workspaceId, "groupBy", groupBy), [workspaceId, groupBy]);

  // Keep selection valid; "inbox" resolves against the seeded Inbox bucket.
  const inboxId = inbox?.id ?? null;
  useEffect(() => {
    if (selection === "all" || selection === "inbox" || selection === "today") return;
    if (inboxId && selection === inboxId) return;
    if (!buckets.some((b) => b.id === selection)) setSelection("inbox");
  }, [selection, buckets, inboxId]);

  // "All" implies bucket grouping; a single bucket flattens it. Nudge groupBy on
  // scope changes so the control stays meaningful (the user can still override).
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

  const scopeTasks = useMemo(() => {
    if (selection === "today") return api.committedTasks;
    if (selection === "all") return tasks.filter((t) => t.status !== "archived");
    const bucketId = selection === "inbox" ? inboxId : selection;
    if (!bucketId) return [];
    return tasks.filter((t) => t.bucketId === bucketId && t.status !== "archived");
  }, [selection, tasks, inboxId, api.committedTasks]);

  const scopeTitle =
    isAll ? "All" : selection === "today" ? "Today" : selection === "inbox" ? "Inbox" : bucketNameById(selection);

  // The commit queue is inherently ordered, so Today is never grouped.
  const effectiveGroupBy = selection === "today" ? "none" : groupBy;

  // Where a captured task lands: the selected bucket, else Inbox.
  const captureBucketId =
    isAll || selection === "today" ? inboxId : selection === "inbox" ? inboxId : selection;

  const totalOpenCount = useMemo(
    () => tasks.filter((t) => t.status !== "done" && t.status !== "archived").length,
    [tasks],
  );
  const committedCount = api.committedTasks.length;

  const openCapture = useCallback(() => {
    if (canEdit) setCaptureOpen(true);
  }, [canEdit]);

  // cmd+n / global "+" → capture (this listener is only mounted on /tasks).
  useEffect(() => onCreateNew(openCapture), [openCapture]);

  const exitExecute = useCallback(() => setMode("plan"), []);

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
    />
  );

  // Execute mode is enclosed in the center panel (rails stay visible).
  const body =
    mode === "execute" ? (
      <ExecuteView
        committedTasks={api.committedTasks}
        bucketNameById={bucketNameById}
        onMarkDone={api.markDone}
        onSkip={api.rescheduleFromToday}
        onDoLast={api.doLast}
        onExit={exitExecute}
      />
    ) : (
      <TaskListView
        tasks={scopeTasks}
        scopeTitle={scopeTitle}
        selection={selection}
        groupBy={effectiveGroupBy}
        onGroupByChange={setGroupBy}
        buckets={buckets}
        inbox={inbox}
        bucketNameById={bucketNameById}
        canEdit={canEdit}
        onRequestCapture={openCapture}
        api={api}
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
    <div className="flex h-full min-h-0 flex-col gap-2">
      <h2 className="font-display text-sm text-foreground">Context</h2>
      <p className="text-sm text-muted-foreground">
        Placeholder panel. Task details, a mini-calendar, and related context will
        live here in future sessions.
      </p>
      <p className="mt-auto text-xs text-muted-foreground/70">
        Drag the divider to resize — this rail is here for layout testing.
      </p>
    </div>
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
    </>
  );
}
