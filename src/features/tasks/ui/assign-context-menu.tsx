// The "Assign to" submenu of a task's context menu, shared by list rows and
// board cards: Unassigned, then the members (view-only ones listed, not
// pickable). Assigning goes through tasks_op_assign (api.patchTask).

import { toast } from "sonner";
import {
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "../../../components/ui/context-menu";
import { assigneeOptions, fromAssigneeValue, toAssigneeValue } from "../assignee-options";
import { previewAssign, useAssignees } from "../assignees";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";

export function AssignContextMenu({
  task,
  api,
}: {
  task: Task;
  api: Pick<TasksModuleApi, "patchTask">;
}) {
  const { assignees } = useAssignees();
  // Solo workspaces have nobody to hand a task to.
  if (assignees.length < 2) return null;
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Assign to</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuRadioGroup
          value={toAssigneeValue(task.assigneeId)}
          onValueChange={(v) => {
            const next = fromAssigneeValue(v);
            if (next === task.assigneeId) return;
            if (next) {
              const person = assignees.find((a) => a.userId === next);
              if (!person?.canTakeTasks) return;
              void previewAssign(task.bucketId, next).then((msg) => {
                if (msg) toast.message(msg);
              });
            }
            api.patchTask(task.id, { assigneeId: next });
          }}
        >
          {assigneeOptions(assignees).map((o) => (
            <ContextMenuRadioItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
