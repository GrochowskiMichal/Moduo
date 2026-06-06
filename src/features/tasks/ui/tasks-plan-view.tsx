import { useCallback, useEffect, useMemo, useState } from "react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { onCreateNew } from "../../../components/app/create-events";
import type { GroupBy } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { BucketRail, type TasksMode } from "./bucket-rail";
import { CaptureModal } from "./capture-modal";
import { ExecuteStub } from "./execute-stub";
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
    if (selection === "all" || selection === "inbox") return;
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
    if (selection === "all") return tasks.filter((t) => t.status !== "archived");
    const bucketId = selection === "inbox" ? inboxId : selection;
    if (!bucketId) return [];
    return tasks.filter((t) => t.bucketId === bucketId && t.status !== "archived");
  }, [selection, tasks, inboxId]);

  const scopeTitle = isAll ? "All" : selection === "inbox" ? "Inbox" : bucketNameById(selection);

  // Where a captured task lands: the selected bucket, else Inbox.
  const captureBucketId = isAll ? inboxId : selection === "inbox" ? inboxId : selection;
  const captureBucketName = captureBucketId ? bucketNameById(captureBucketId) : "Inbox";

  const totalOpenCount = useMemo(
    () => tasks.filter((t) => t.status !== "done" && t.status !== "archived").length,
    [tasks],
  );
  const committedCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tasks.filter((t) => t.committedFor === today && t.status !== "archived").length;
  }, [tasks]);

  const openCapture = useCallback(() => {
    if (canEdit) setCaptureOpen(true);
  }, [canEdit]);

  // cmd+n / global "+" → capture (this listener is only mounted on /tasks).
  useEffect(() => onCreateNew(openCapture), [openCapture]);

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
      canEdit={canEdit}
      onCreateBucket={api.createBucket}
      onRenameBucket={api.renameBucket}
      onDeleteBucket={api.deleteBucket}
    />
  );

  const center =
    mode === "execute" ? (
      <ExecuteStub committedCount={committedCount} onBackToPlan={() => setMode("plan")} />
    ) : (
      <TaskListView
        tasks={scopeTasks}
        scopeTitle={scopeTitle}
        selection={selection}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        buckets={buckets}
        inbox={inbox}
        bucketNameById={bucketNameById}
        canEdit={canEdit}
        onRequestCapture={openCapture}
        api={api}
      />
    );

  return (
    <>
      <FeaturePanelsShell feature="tasks" left={left} center={center} hideRight />
      <CaptureModal
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        bucketId={captureBucketId}
        bucketName={captureBucketName}
        onCreate={api.createTask}
      />
    </>
  );
}
