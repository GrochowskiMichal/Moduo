// The one context menu for a task, wherever it shows (tasks-v3 §5: "one
// context menu for rows, cards and bars"; TV-U11 moved it out of the List's
// row so the Board's card opens the same one). It takes the task, its facts
// and id-taking callbacks only (TV-D11b: a memoised row or card never holds
// the module API or a whole list).

import { isClosedTask, taskCategoryOf } from "@contracts/vocabularies";
import { type ReactNode, useRef } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import { taskLinkId } from "../../../lib/task-handle";
import { taskUrl } from "../../../lib/web-origin";
import { LEVEL_OPTIONS } from "../helpers";
import type { EnergyLevel, PriorityLevel, Task } from "../model";
import { handleLabel } from "../row-layout";
import { AssignContextMenu } from "./assign-context-menu";
import type { TaskFacts, TaskRowActions } from "./row-facts";
import { SelectionAware } from "./selection-menu";

/** Which inline menu or popover the keyboard (or this menu) asks to open. */
export type TaskCommand = "bucket" | "schedule" | "due" | "status";

/** Finish an open task, or reopen a closed one (To do): the glyph, Space, `x`. */
export function activateTask(task: Task, actions: TaskRowActions): void {
  if (!isClosedTask(task)) {
    actions.toggleDone(task);
    return;
  }
  // Done goes back the way it always has; Won't do reopens to To do too.
  if (taskCategoryOf(task) === "done") actions.toggleDone(task);
  else actions.setTaskStatus(task.id, { category: "todo" });
}

/**
 * A task's right-click menu. Read-only (research §9): Open · Copy link ·
 * Copy as text. Otherwise the full menu; items that hand focus to something
 * inside the row or card (the title editor, a chip's popover) run once the
 * menu has closed, or Radix's focus return would close what they opened.
 */
export function TaskContextMenu({
  task,
  facts,
  canEdit,
  taskKey = null,
  actions,
  onOpen,
  onRename,
  onRequestCommand,
  children,
}: {
  task: Task;
  facts: Pick<TaskFacts, "queued">;
  canEdit: boolean;
  /** The workspace's task key ("MOD"): the link names the handle. */
  taskKey?: string | null;
  actions: TaskRowActions;
  onOpen: (taskId: string) => void;
  onRename: (taskId: string) => void;
  onRequestCommand: (taskId: string, command: TaskCommand) => void;
  /** The row or card: the menu's trigger. */
  children: ReactNode;
}) {
  const pendingMenuAction = useRef<(() => void) | null>(null);
  const afterMenuClose = (action: () => void) => {
    pendingMenuAction.current = action;
  };
  const handle = handleLabel(taskKey, task.number);
  const done = taskCategoryOf(task) === "done";
  const closed = isClosedTask(task);

  const copyLink = () => {
    // The handle when it has one (MOD-28), on the web's origin even on desktop.
    const url = taskUrl(taskLinkId(taskKey, task));
    void navigator.clipboard?.writeText(url).then(
      () => toast("Link copied"),
      () => toast.error("Couldn’t copy."),
    );
  };
  const copyText = () => {
    const text = handle ? `${task.title || "Untitled"} (${handle})` : task.title || "Untitled";
    void navigator.clipboard?.writeText(text).then(
      () => toast("Copied"),
      () => toast.error("Couldn’t copy."),
    );
  };

  if (!canEdit) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => onOpen(task.id)}>Open</ContextMenuItem>
          <ContextMenuItem onSelect={copyLink}>Copy link</ContextMenuItem>
          <ContextMenuItem onSelect={copyText}>Copy as text</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="w-48"
        onCloseAutoFocus={(e) => {
          const action = pendingMenuAction.current;
          if (!action) return;
          pendingMenuAction.current = null;
          e.preventDefault(); // the editor or popover takes focus, not the view
          action();
        }}
      >
        {/* A task of a selection: the menu acts on the selection (TV-U12). */}
        <SelectionAware taskId={task.id} afterClose={afterMenuClose}>
          <ContextMenuItem onSelect={() => afterMenuClose(() => onRename(task.id))}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => activateTask(task, actions)}>
            {done ? "Mark not done" : closed ? "Reopen" : "Mark done"}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "status"))}
          >
            Status…
          </ContextMenuItem>
          {!closed && task.status !== "archived" ? (
            <>
              <ContextMenuItem onSelect={() => actions.focusOnTask(task.id)}>
                Focus on this
                <ContextMenuShortcut>⇧F</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => actions.toggleQueue(task.id)}>
                {facts.queued ? "Remove from Focus" : "Add to Focus"}
                <ContextMenuShortcut>Q</ContextMenuShortcut>
              </ContextMenuItem>
            </>
          ) : null}
          {task.recurrence && !closed ? (
            <ContextMenuItem onSelect={() => actions.skipOccurrence(task.id)}>
              Skip occurrence
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "schedule"))}
          >
            Schedule…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "due"))}>
            Set due date…
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => afterMenuClose(() => onRequestCommand(task.id, "bucket"))}
          >
            Move to project…
          </ContextMenuItem>
          {task.parentId ? (
            <ContextMenuItem onSelect={() => actions.setTaskParent(task.id, null)}>
              Detach from parent
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <AssignContextMenu task={task} patchTask={actions.patchTask} />
          <ContextMenuSub>
            <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={task.priority ?? "none"}
                onValueChange={(v) =>
                  actions.patchTask(task.id, {
                    priority: v === "none" ? null : (v as PriorityLevel),
                  })
                }
              >
                <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
                {LEVEL_OPTIONS.map((l) => (
                  <ContextMenuRadioItem key={l.value} value={l.value}>
                    {l.label}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Energy</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={task.energyLevel ?? "none"}
                onValueChange={(v) =>
                  actions.patchTask(task.id, {
                    energyLevel: v === "none" ? null : (v as EnergyLevel),
                  })
                }
              >
                <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
                {LEVEL_OPTIONS.map((l) => (
                  <ContextMenuRadioItem key={l.value} value={l.value}>
                    {l.label}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={copyLink}>Copy link</ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => actions.deleteTask(task.id)}>
            Delete
          </ContextMenuItem>
        </SelectionAware>
      </ContextMenuContent>
    </ContextMenu>
  );
}
