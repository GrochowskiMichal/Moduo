// Spike: task edits through @tanstack/offline-transactions. The optimistic
// change lands in the collection at once; the outbox (IndexedDB) holds it
// until `tasks_op_update` answers, which PATCHes only the changed fields;
// the server's row then goes back in through writeUpsert.

import type { TaskRow } from "@contracts/rows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError, startOfflineExecutor } from "@tanstack/offline-transactions";
import type { TasksHandle } from "./tasks-collection";

export type EditVars = { id: string; patch: Partial<TaskRow> };

export function startTaskWrites(opts: {
  supabase: SupabaseClient;
  workspaceId: string;
  tasks: TasksHandle;
  onServerRow?: (row: TaskRow) => void;
}) {
  const { supabase, workspaceId, tasks } = opts;
  const executor = startOfflineExecutor({
    collections: { [tasks.collection.id]: tasks.collection as never },
    mutationFns: {
      patchTask: async ({ transaction }) => {
        for (const m of transaction.mutations) {
          // `changes` holds only the fields this edit touched.
          const patch = m.changes as Record<string, unknown>;
          const { data, error } = await supabase.rpc("tasks_op_update", {
            p_workspace_id: workspaceId,
            p_task_id: m.key as string,
            p_patch: patch,
          });
          if (error) {
            if (error.code?.startsWith("P0") || error.code === "42501")
              throw new NonRetriableError(error.message);
            throw new Error(error.message);
          }
          const row = (Array.isArray(data) ? data[0] : data) as TaskRow;
          tasks.writeUpsert(row);
          opts.onServerRow?.(row);
        }
      },
    },
  });

  const editTask = executor.createOfflineAction<EditVars>({
    mutationFnName: "patchTask",
    onMutate: ({ id, patch }) => {
      tasks.collection.update(id, (draft) => {
        Object.assign(draft, patch);
      });
    },
  });

  return { executor, editTask };
}
