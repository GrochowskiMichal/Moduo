// The pickers a Timeline row's context menu opens (TV-TL1; the one menu is
// TV-U11's `TaskContextMenu`): Status…, Schedule…, Set due date… and Move to
// project…, anchored at the end of the row's name cell. The List opens the
// same pickers from its own cells; the Timeline's row has no cells, so they
// open here, saving the way the List's do (one save when the picker closes).

import type { ReactNode } from "react";

import { DatePickerPanel, useDateDraft } from "../../../components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import type { Task } from "../model";
import { ProjectMenuItems, StatusMenuItems } from "./project-choices";
import type { TaskRowActions } from "./row-facts";
import type { TaskCommand } from "./task-context-menu";

/** The pickers' anchor: the end of the name cell, out of sight and reach. */
const ANCHOR = "pointer-events-none absolute inset-y-0 right-3 w-0";

export function TimelineTaskCommand({
  task,
  command,
  actions,
  onDone,
  refocus,
}: {
  task: Task;
  command: TaskCommand;
  actions: TaskRowActions;
  onDone: () => void;
  refocus: () => void;
}) {
  if (command === "due" || command === "schedule") {
    return (
      <DateCommand task={task} kind={command} actions={actions} onDone={onDone} refocus={refocus} />
    );
  }
  const close = (open: boolean) => {
    if (!open) onDone();
  };
  const content: ReactNode =
    command === "status" ? (
      <StatusMenuItems
        task={task}
        onPick={(target) => {
          actions.setTaskStatus(task.id, target);
          onDone();
        }}
      />
    ) : (
      <DropdownMenuRadioGroup
        value={task.bucketId}
        onValueChange={(id) => {
          if (id !== task.bucketId) actions.patchTask(task.id, { bucketId: id });
          onDone();
        }}
      >
        <ProjectMenuItems />
      </DropdownMenuRadioGroup>
    );
  return (
    <DropdownMenu open onOpenChange={close} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className={ANCHOR} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={command === "status" ? "w-56" : "w-48"}
        align="end"
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          refocus();
        }}
      >
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DateCommand({
  task,
  kind,
  actions,
  onDone,
  refocus,
}: {
  task: Task;
  kind: "due" | "schedule";
  actions: TaskRowActions;
  onDone: () => void;
  refocus: () => void;
}) {
  const current = kind === "schedule" ? task.scheduledAt : task.dueDate;
  const draft = useDateDraft({
    value: current ? new Date(current) : null,
    onChange: (d) =>
      actions.patchTask(
        task.id,
        kind === "schedule"
          ? { scheduledAt: d ? d.toISOString() : null }
          : { dueDate: d ? d.toISOString() : null },
      ),
    withTime: kind === "schedule",
    open: true,
    done: onDone,
  });
  return (
    <Popover open onOpenChange={(open) => (open ? undefined : draft.close())}>
      <PopoverTrigger asChild>
        <span aria-hidden className={ANCHOR} />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="end"
        onClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={draft.cancel}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          refocus();
        }}
      >
        <DatePickerPanel
          draft={draft}
          heading={kind === "schedule" ? "Scheduled time" : "Due date"}
        />
      </PopoverContent>
    </Popover>
  );
}
