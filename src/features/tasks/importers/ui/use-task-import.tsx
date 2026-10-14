// The Tasks page's side of "Import tasks…" (TV-U18): whether it's offered
// (Tasks edit, and a runtime with the import ops), the dialog, and what the
// dialog reads from the shared store. After an import or an Undo the store
// reads again, so new projects and tasks show everywhere at once.

import { useCallback, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../../lib/runtime.types";
import type { WorkspaceStore } from "../../../../lib/sync/store";
import { useAuth } from "../../../../providers/auth-provider";
import { useAssignees } from "../../assignees";
import type { Bucket, Section, Task } from "../../model";
import { importApiOf, TaskImportDialog } from "./import-dialog";

export function useTaskImport({
  runtime,
  store,
  workspaceId,
  userId,
  canEdit,
  buckets,
  sections,
  tasks,
  archivedTasks,
  onOpenProject,
}: {
  runtime: ModuoRuntime | null;
  store: WorkspaceStore | null;
  workspaceId: string | null;
  userId: string | null;
  canEdit: boolean;
  buckets: readonly Bucket[];
  sections: readonly Section[];
  tasks: readonly Task[];
  /** Tasks of archived projects: an earlier import's may be there. */
  archivedTasks: readonly Task[];
  onOpenProject: (projectId: string) => void;
}) {
  const { userEmail } = useAuth();
  // The pickers' people: names only (members' emails aren't readable here).
  const { assignees } = useAssignees();
  const [open, setOpen] = useState(false);
  const supported = canEdit && Boolean(workspaceId && userId) && importApiOf(runtime) !== null;
  const latest = useRef({ buckets, sections, tasks, archivedTasks });
  latest.current = { buckets, sections, tasks, archivedTasks };
  // Read when the preview needs it, not on every store change.
  const readContext = useCallback(() => {
    const now = latest.current;
    return {
      projects: now.buckets
        .filter((b) => !b.isSystem && !b.deletedAt)
        .map((b) => ({ id: b.id, name: b.name })),
      sections: now.sections,
      tasks: now.archivedTasks.length ? [...now.tasks, ...now.archivedTasks] : now.tasks,
    };
  }, []);
  const whenReady = useCallback(async () => {
    await store?.whenRest();
  }, [store]);
  const onChanged = useCallback(async () => {
    await store?.syncNow();
  }, [store]);

  const dialog = useMemo(
    () =>
      supported && workspaceId && userId ? (
        <TaskImportDialog
          open={open}
          onOpenChange={setOpen}
          runtime={runtime}
          workspaceId={workspaceId}
          userId={userId}
          userEmail={userEmail}
          assignees={assignees}
          readContext={readContext}
          whenReady={whenReady}
          onChanged={onChanged}
          onOpenProject={onOpenProject}
        />
      ) : null,
    [
      supported,
      open,
      runtime,
      workspaceId,
      userId,
      userEmail,
      assignees,
      readContext,
      whenReady,
      onChanged,
      onOpenProject,
    ],
  );

  const openDialog = useCallback(() => setOpen(true), []);
  return { supported, open: openDialog, dialog };
}
