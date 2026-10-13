// The detail panel's header (Tasks v3 §9, research views-board-detail §7):
// the breadcrumb "● Project › Section" (each part a picker that moves the
// task; a subtask goes on to "↳ parent"), the handle (click to copy), a slot
// for who "is on this" (claims, TV-F7), the Focus toggle and ▶ "Focus on
// this" (call 31), ⤢ full page, and ⋯ (Copy branch name, Copy link, where
// an import brought it from (TV-U18), Duplicate, Save as template…, Make it a task, Won't do / Reopen, Delete).

import {
  Ban,
  ChevronRight,
  Copy,
  CornerDownRight,
  Ellipsis,
  FileInput,
  GitBranch,
  Inbox,
  LayoutTemplate,
  Link2,
  ListChecks,
  Lock,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Trash2,
  Unlink,
} from "lucide-react";
import { type ReactNode, useContext, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Kbd } from "../../../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { taskHandle } from "../../../lib/task-handle";
import { cn } from "../../../lib/utils";
import { taskUrl } from "../../../lib/web-origin";
import { useTaskClaim } from "../../focus/claims";
import { useFocusTaskState } from "../../focus/timer";
import { TaskClaimMark } from "../../focus/ui/claim-mark";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { branchName } from "../detail-properties";
import { duplicateFields } from "../duplicate";
import { isUnfinished } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { importedFromLine } from "../importers/plan";
import { type Bucket, PRIVATE_PROJECT_LABEL, type Task } from "../model";
import { alsoInLabel, claimLabel } from "../queue";
import { ClaimAvatar, useClaimNames, withoutPeopleOnIt } from "./queue-toggle";

type Props = {
  task: Task;
  parent: Task | null;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  api: TasksModuleApi;
  /** Open another task in the panel ("← item"): the parent from a subtask. */
  onOpenTask: (id: string) => void;
  /** Select a task in the page (a duplicate opens there). */
  onSelectTask: (id: string) => void;
  /** ⤢: the task fills the centre (call 32). Absent where there is no centre to fill. */
  onOpenFullPage?: () => void;
  /** ⤡: back to the panel (on the full page). */
  onCloseFullPage?: () => void;
  /** Who "is on this" (claims). Defaults to the Focus claim mark (TV-F6). */
  claimSlot?: ReactNode;
  /** ⋯ → Save as template… (TV-D15). Absent: not offered. */
  onSaveAsTemplate?: () => void;
};

const crumb =
  "flex min-h-(--ctrl-h-sm) min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-0.5 font-sans text-xs text-muted-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-state-active aria-expanded:text-foreground disabled:hover:bg-transparent disabled:hover:text-muted-foreground";

export function TaskDetailHeader({
  task,
  parent,
  buckets,
  inbox,
  canEdit,
  api,
  onOpenTask,
  onSelectTask,
  onOpenFullPage,
  onCloseFullPage,
  claimSlot,
  onSaveAsTemplate,
}: Props) {
  const bucketOptions = inbox ? [inbox, ...buckets.filter((b) => b.id !== inbox.id)] : buckets;
  const bucket = bucketOptions.find((b) => b.id === task.bucketId) ?? null;
  // A project you can't see is never shown as Inbox (TV-P0, AC1.10).
  const bucketLabel = bucket?.name ?? PRIVATE_PROJECT_LABEL;
  const sections = api.sections
    .filter((s) => s.projectId === task.bucketId)
    .sort((a, b) => a.position - b.position);
  const section = sections.find((s) => s.id === task.sectionId) ?? null;
  const open = isUnfinished(task);
  // The handle, MOD-142 (TV-D8). Read without requiring the provider, so the
  // panel renders in isolation (stories, tests) without one.
  const taskKey = useContext(WorkspaceContext)?.selectedWorkspace?.taskKey ?? null;
  const handle = taskHandle(taskKey, task.number);
  // Where an import brought it from (TV-U18): the source's own id, copyable.
  const imported = importedFromLine(task.importedFrom);

  const copy = (text: string, done: string) => {
    if (!navigator.clipboard) {
      toast(`Couldn’t copy ${text}.`);
      return;
    }
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(done))
      .catch(() => toast(`Couldn’t copy ${text}.`));
  };

  const duplicate = () => {
    const created = api.createTask(duplicateFields(task));
    for (const tag of api.tagsByTask.get(task.id) ?? []) api.createTagForTask(tag.name, created);
    void created.then((copyOf) => {
      if (!copyOf) return;
      onSelectTask(copyOf.id);
      toast("Task duplicated");
    });
  };

  return (
    <div className="flex min-h-(--ctrl-h) shrink-0 items-center gap-1">
      {/* Names wrap, never truncate (AC1.16). */}
      <nav aria-label="Location" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
        <ProjectCrumb
          task={task}
          bucket={bucket}
          label={bucketLabel}
          options={bucketOptions}
          canEdit={canEdit}
          api={api}
        />
        {sections.length > 0 && !parent ? (
          <>
            <ChevronRight className="size-icon-xs shrink-0 text-muted-foreground/60" aria-hidden />
            <SectionCrumb
              task={task}
              section={section}
              sections={sections}
              canEdit={canEdit}
              api={api}
            />
          </>
        ) : null}
        {parent ? (
          <>
            <ChevronRight className="size-icon-xs shrink-0 text-muted-foreground/60" aria-hidden />
            <button
              type="button"
              onClick={() => onOpenTask(parent.id)}
              aria-label={`Parent task: ${parent.title || "Untitled"}`}
              className={crumb}
            >
              <CornerDownRight className="size-icon-xs shrink-0" aria-hidden />
              <span className="min-w-0 break-words text-left">{parent.title || "Untitled"}</span>
            </button>
          </>
        ) : null}
        {handle ? (
          <>
            <ChevronRight className="size-icon-xs shrink-0 text-muted-foreground/60" aria-hidden />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => copy(handle, `Copied ${handle}`)}
                  aria-label={`Copy ${handle}`}
                  className={cn(crumb, "shrink-0 whitespace-nowrap tabular-nums")}
                >
                  {handle}
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy {handle}</TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </nav>

      {claimSlot ?? <TaskClaimMark workspaceId={task.workspaceId} taskId={task.id} />}
      {open ? <QueueButton task={task} api={api} canEdit={canEdit} /> : null}
      {open && canEdit ? <FocusOnThisButton task={task} api={api} /> : null}
      {onOpenFullPage ? (
        <IconButton icon={Maximize2} label="Open full page" onClick={onOpenFullPage} />
      ) : null}
      {onCloseFullPage ? (
        <IconButton icon={Minimize2} label="Back to the panel" onClick={onCloseFullPage} />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={Ellipsis} label="More actions" tooltip={null} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={() => {
              const name = branchName(handle, task.title);
              copy(name, `Copied ${name}`);
            }}
          >
            <GitBranch aria-hidden />
            Copy branch name
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(taskUrl(task.id), "Link copied")}>
            <Link2 aria-hidden />
            Copy link
          </DropdownMenuItem>
          {imported ? (
            <DropdownMenuItem
              disabled={!imported.key}
              onSelect={() => imported.key && copy(imported.key, `Copied ${imported.key}`)}
            >
              <FileInput aria-hidden />
              <span className="min-w-0 break-words">
                {imported.label}
                {imported.key ? ` · ${imported.key}` : ""}
              </span>
            </DropdownMenuItem>
          ) : null}
          {onOpenFullPage ? (
            <DropdownMenuItem onSelect={onOpenFullPage}>
              <Maximize2 aria-hidden />
              Open full page
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={duplicate}>
                <Copy aria-hidden />
                Duplicate
              </DropdownMenuItem>
              {onSaveAsTemplate ? (
                <DropdownMenuItem onSelect={onSaveAsTemplate}>
                  <LayoutTemplate aria-hidden />
                  Save as template…
                </DropdownMenuItem>
              ) : null}
              {parent ? (
                <DropdownMenuItem onSelect={() => api.setTaskParent(task.id, null)}>
                  <Unlink aria-hidden />
                  Make it a task
                </DropdownMenuItem>
              ) : null}
              {task.status === "archived" ? (
                <DropdownMenuItem onSelect={() => api.patchTask(task.id, { status: "todo" })}>
                  <RotateCcw aria-hidden />
                  Reopen
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => api.archiveTask(task.id)}>
                  <Ban aria-hidden />
                  Won’t do
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => api.deleteTask(task.id)}>
                <Trash2 aria-hidden />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** "● Acme rebrand": moves the task to another project (by area, Inbox first). */
function ProjectCrumb({
  task,
  bucket,
  label,
  options,
  canEdit,
  api,
}: {
  task: Task;
  bucket: Bucket | null;
  label: string;
  options: Bucket[];
  canEdit: boolean;
  api: TasksModuleApi;
}) {
  const [open, setOpen] = useState(false);
  const areaName = (b: Bucket) => api.areas.find((a) => a.id === b.areaId)?.name ?? null;
  const groups = new Map<string, Bucket[]>();
  for (const b of options) {
    const key = b.isSystem ? "" : (areaName(b) ?? "");
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button
          type="button"
          aria-label={`Project: ${label}. Move to another project`}
          className={cn(crumb, "-ml-1.5")}
        >
          {bucket?.isSystem ? (
            <Inbox className="size-icon-xs shrink-0" aria-hidden />
          ) : bucket ? (
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground/60" />
          ) : (
            <Lock className="size-icon-xs shrink-0" aria-hidden />
          )}
          <span className="min-w-0 break-words text-left">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Move to…" />
          <CommandList>
            <CommandEmpty>No matching project.</CommandEmpty>
            {[...groups].map(([area, list]) => (
              // People name areas, so an area reads in sentence case beside
              // each project, never as a small-caps heading (call 40).
              <CommandGroup key={area || "none"}>
                {list.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`${b.name} ${area} ${b.id}`}
                    onSelect={() => {
                      setOpen(false);
                      if (b.id !== task.bucketId) api.patchTask(task.id, { bucketId: b.id });
                    }}
                  >
                    {b.isSystem ? <Inbox className="text-muted-foreground" aria-hidden /> : null}
                    <span className="min-w-0 flex-1 break-words">{b.name}</span>
                    {area ? (
                      <span className="shrink-0 font-sans text-xs text-muted-foreground">
                        {area}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** "› Design": the section inside the project, or No section. */
function SectionCrumb({
  task,
  section,
  sections,
  canEdit,
  api,
}: {
  task: Task;
  section: { id: string; name: string } | null;
  sections: { id: string; name: string }[];
  canEdit: boolean;
  api: TasksModuleApi;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <button
          type="button"
          aria-label={`Section: ${section?.name ?? "No section"}. Move to another section`}
          className={crumb}
        >
          <span className="min-w-0 break-words text-left">{section?.name ?? "No section"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Section…" />
          <CommandList>
            <CommandEmpty>No matching section.</CommandEmpty>
            <CommandGroup>
              {sections.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.name} ${s.id}`}
                  onSelect={() => {
                    setOpen(false);
                    if (s.id !== task.sectionId) api.patchTask(task.id, { sectionId: s.id });
                  }}
                >
                  <span className="min-w-0 flex-1 break-words">{s.name}</span>
                </CommandItem>
              ))}
              <CommandItem
                value="no section"
                onSelect={() => {
                  setOpen(false);
                  if (task.sectionId) api.patchTask(task.id, { sectionId: null });
                }}
              >
                No section
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Focus on this" (call 31): on top of my Up next, with the one clock. Hidden
 * while my session is already on this task.
 */
function FocusOnThisButton({ task, api }: { task: Task; api: TasksModuleApi }) {
  const focus = useFocusTaskState();
  if (focus.active && focus.taskId === task.id) return null;
  return (
    <IconButton
      icon={Play}
      label="Focus on this"
      tooltip={
        <>
          Focus on this <Kbd>⇧F</Kbd>
        </>
      }
      onClick={() => api.focusOnTask(task.id)}
    />
  );
}

/**
 * My Focus toggle (TV-D4; call 61 renamed the Queue), plus who else has the
 * task lined up: their ringed avatar beside it, named in the tooltip ("In
 * Mike's Focus"). Someone whose session is on it shows once, in the claim
 * slot as "Mike is on this", not here too (TV-F7: one avatar per person).
 * View-only members see the state without the action.
 */
function QueueButton({
  task,
  api,
  canEdit,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
}) {
  const queued = api.queuedTaskIds.has(task.id);
  const onIt = useTaskClaim(task.workspaceId, task.id);
  const claim = useClaimNames(withoutPeopleOnIt(api.queueClaims.get(task.id) ?? [], onIt));
  const claimed = claim.names.length > 0;
  const note = claimed ? (queued ? alsoInLabel(claim.names) : claimLabel(claim.names)) : null;
  const claimMark = claimed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={note ?? undefined}
          className="flex shrink-0 items-center px-0.5"
        >
          <ClaimAvatar assignee={claim.first} size="icon" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  ) : null;

  if (!canEdit) {
    if (!queued) return claimMark;
    return (
      <>
        {claimMark}
        <span className="flex h-(--ctrl-h-sm) shrink-0 items-center gap-1.5 px-1.5 font-sans text-xs text-muted-foreground">
          <ListChecks className="size-icon-sm text-primary" aria-hidden />
          In Focus
        </span>
      </>
    );
  }

  const action = queued ? "Remove from Focus" : "Add to Focus";
  return (
    <>
      {claimMark}
      <Tooltip>
        <TooltipTrigger asChild>
          {/* An icon, like ⤢ and ⋯ beside it: the breadcrumb keeps the room
              (a 280 px panel), and ▶ "Focus on this" sits next to it. */}
          <Button
            type="button"
            variant={queued ? "secondary" : "ghost"}
            size="icon"
            aria-pressed={queued}
            aria-label={queued ? "In Focus" : "Add to Focus"}
            onClick={() => api.toggleQueue(task.id)}
            className="shrink-0"
          >
            <ListChecks className={queued ? "text-primary" : "text-muted-foreground"} aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {queued ? "In Focus · " : ""}
          {action} <Kbd>Q</Kbd>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
