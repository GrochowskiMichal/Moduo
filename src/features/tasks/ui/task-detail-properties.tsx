// The detail panel's properties (Tasks v3 §9, research views-board-detail
// §8). Every value starts at the same x behind a 14px icon slot and edits in
// place through one picker (no chevrons; hover shows the field). Status,
// Assignee + Team, Priority, Due and Tags always show; Energy, Scheduled,
// Reminder, Estimate, Repeat and Waiting on show once set, and until then
// sit in one quiet "+" line that names them on one line, "+n" for what
// doesn't fit (MOD-114; `AddPropertyLine`, which the Project view shares,
// MOD-151). The line opens a menu of them all; picking one shows
// its row, empty, with its editor open (Waiting on opens its list, below the
// properties). Values wrap and never truncate; the label column narrows from
// 96 to 76 px when the panel is under 320 px (the panel is the container).

import {
  TASK_STATUS_CATEGORIES,
  type TaskStatusCategory,
  taskCategoryOf,
} from "@contracts/vocabularies";
import {
  Bell,
  CalendarClock,
  Hourglass,
  Inbox,
  type LucideIcon,
  Plus,
  Repeat,
  Timer,
  User,
  Users,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { TagChip } from "../../../components/tag-chip";
import { TagPicker } from "../../../components/tag-picker";
import { TeamMark } from "../../../components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../../components/ui/command";
import { DateField } from "../../../components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { PropertyRow, PropertyValue } from "../../../components/ui/property-row";
import { localDayOf } from "../../../lib/task-rows";
import { formatDay } from "../../../lib/time-format";
import { cn } from "../../../lib/utils";
import { type Assignee, assigneeLabel, assigneeListName, SELF_KEYWORDS } from "../assignee-options";
import { previewAssign, useAssignees } from "../assignees";
import { dueDayOf } from "../bulk";
import {
  OPTIONAL_PROPERTY_LABELS,
  type OptionalProperty,
  type PropertyExtras,
  quietLineProperties,
  shownOptionalProperties,
} from "../detail-properties";
import { LEVEL_OPTIONS } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, EnergyLevel, PriorityLevel, Task } from "../model";
import { changePatternRule, engineZone } from "../recurrence-engine";
import { CATEGORY_LABELS, statusesByCategory, statusNameOf } from "../statuses";
import { type AddPropertyItem, AddPropertyLine } from "./add-property-line";
import { AssigneeAvatar } from "./assignee-avatar";
import { EnergyIcon, PriorityIcon } from "./level-icons";
import { RepeatMoveDialog } from "./repeat-move-dialog";
import { StatusIcon } from "./status-icon";
import {
  DueTimeValue,
  EstimateValue,
  ReminderValue,
  RepeatHistory,
  RepeatValue,
  SessionsValue,
} from "./task-detail-pickers";

type Props = {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
  /** My share of the task's tracked time (null until known). */
  mySeconds: number | null;
  /** Projects the task can be filed into ("Assign to Mike · in [Project ▾]"). */
  projects: Bucket[];
  /** The task's Waiting on list is shown (it lives below the properties). */
  waitingShown: boolean;
  /** "+ Waiting on" was picked: show the list with its picker open. */
  onRevealWaiting: () => void;
};

export function TaskDetailProperties({
  task,
  api,
  canEdit,
  mySeconds,
  projects,
  waitingShown,
  onRevealWaiting,
}: Props) {
  // Rows picked from the quiet line stay while this task is open, even empty.
  const [revealed, setRevealed] = useState<Set<OptionalProperty>>(() => new Set());
  // The row that was just revealed opens its editor once, on mount.
  const [opening, setOpening] = useState<OptionalProperty | null>(null);
  const sessions = api.sessions.filter((s) => s.taskId === task.id);
  const reminders = api.reminders.filter((r) => r.taskId === task.id);
  const extras: PropertyExtras = {
    sessions: sessions.length,
    reminders: reminders.length,
    waiting: waitingShown ? 1 : 0,
  };
  const shown = shownOptionalProperties(task, revealed, extras);
  const quiet = canEdit ? quietLineProperties(task, revealed, extras) : [];
  const autoOpen = (p: OptionalProperty) => opening === p;
  const { byId, currentUserId } = useAssignees();
  const me = byId(currentUserId);
  const assignee = byId(task.assigneeId);

  // A repeat's due day moved here asks, as Upcoming's drag does (TV-D12's two
  // ways, TV-U13b): just this one (the next is back on the pattern), or the
  // pattern from here on. Clearing the date, or a one-off, saves at once.
  const [repeatMoveTo, setRepeatMoveTo] = useState<Date | null>(null);
  const setDue = (d: Date | null) => {
    const day = dueDayOf(task);
    if (d && task.recurrence && day && localDayOf(d.toISOString()) !== day) {
      setRepeatMoveTo(d);
      return;
    }
    api.patchTask(task.id, d ? { dueDate: d.toISOString() } : { dueDate: null, dueTime: null });
  };
  const chooseRepeatMove = (choice: "one" | "pattern") => {
    const to = repeatMoveTo;
    setRepeatMoveTo(null);
    if (!to || !task.recurrence) return;
    const day = localDayOf(to.toISOString());
    if (choice === "one") {
      if (day) api.moveOccurrence(task.id, { dueOn: day });
      return;
    }
    api.patchTask(task.id, {
      recurrence: changePatternRule(task.recurrence, to, engineZone()),
      dueDate: to.toISOString(),
    });
  };

  const reveal = (p: OptionalProperty) => {
    if (p === "waiting") {
      onRevealWaiting();
      return;
    }
    setRevealed((prev) => new Set(prev).add(p));
    setOpening(p);
  };

  return (
    <div className="flex flex-col gap-px">
      <PropertyRow label="Status">
        <StatusValue task={task} api={api} canEdit={canEdit} />
      </PropertyRow>
      <PropertyRow label="Assignee" align="start">
        <AssigneeValue task={task} api={api} canEdit={canEdit} projects={projects} />
        <TeamValue task={task} api={api} canEdit={canEdit} />
      </PropertyRow>
      <PropertyRow label="Priority">
        <LevelValue
          kind="priority"
          value={task.priority}
          canEdit={canEdit}
          onChange={(v) => api.patchTask(task.id, { priority: v as PriorityLevel | null })}
        />
      </PropertyRow>
      <PropertyRow label="Due">
        <DateField
          variant="property"
          value={task.dueDate ? new Date(task.dueDate) : null}
          onChange={setDue}
          placeholder="Set date"
          aria-label="Due"
          disabled={!canEdit}
        />
        <DueTimeValue task={task} api={api} canEdit={canEdit} />
        <RepeatMoveDialog
          open={repeatMoveTo !== null}
          tasks={[task]}
          dayLabel={repeatMoveTo ? formatDay(repeatMoveTo) : ""}
          onChoose={chooseRepeatMove}
          onClose={() => setRepeatMoveTo(null)}
        />
      </PropertyRow>
      {shown.has("energy") ? (
        <PropertyRow label="Energy">
          <LevelValue
            kind="energy"
            value={task.energyLevel}
            canEdit={canEdit}
            defaultOpen={autoOpen("energy")}
            onChange={(v) => api.patchTask(task.id, { energyLevel: v as EnergyLevel | null })}
          />
        </PropertyRow>
      ) : null}
      {shown.has("scheduled") ? (
        <PropertyRow label="Scheduled">
          <SessionsValue
            task={task}
            sessions={sessions}
            api={api}
            canEdit={canEdit}
            me={me}
            assignee={assignee}
            defaultOpen={autoOpen("scheduled")}
          />
        </PropertyRow>
      ) : null}
      {shown.has("reminder") ? (
        <PropertyRow label="Reminder">
          <ReminderValue
            task={task}
            reminders={reminders}
            api={api}
            defaultOpen={autoOpen("reminder")}
          />
        </PropertyRow>
      ) : null}
      {shown.has("estimate") ? (
        <PropertyRow label="Estimate" align="start">
          <EstimateValue
            task={task}
            api={api}
            canEdit={canEdit}
            mySeconds={mySeconds}
            defaultOpen={autoOpen("estimate")}
          />
        </PropertyRow>
      ) : null}
      {shown.has("repeat") ? (
        <PropertyRow label="Repeat">
          <RepeatValue task={task} api={api} canEdit={canEdit} defaultOpen={autoOpen("repeat")} />
          {task.recurrence ? <RepeatHistory task={task} api={api} /> : null}
        </PropertyRow>
      ) : null}
      <PropertyRow label="Tags" align="start">
        <TagsValue task={task} api={api} canEdit={canEdit} />
      </PropertyRow>
      {quiet.length > 0 ? (
        <AddPropertyLine items={quiet.map(propertyItem)} onPick={reveal} />
      ) : null}
    </div>
  );
}

// ── the "+" line (add-property-line.tsx, shared with the Project view) ────────

const PROPERTY_ICONS: Record<OptionalProperty, LucideIcon> = {
  energy: Zap,
  scheduled: CalendarClock,
  reminder: Bell,
  estimate: Timer,
  repeat: Repeat,
  waiting: Hourglass,
};

const propertyItem = (p: OptionalProperty): AddPropertyItem<OptionalProperty> => ({
  key: p,
  label: OPTIONAL_PROPERTY_LABELS[p],
  icon: PROPERTY_ICONS[p],
});

// ── values ────────────────────────────────────────────────────────────────────

function StatusValue({
  task,
  api,
  canEdit,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
}) {
  // The project's own statuses, grouped by category (REPLAN 53a); the five
  // categories when its statuses aren't readable here (a project you can't
  // see, a database before TV-D9). Hidden ones are listed only while in use.
  const category = taskCategoryOf(task);
  const name = statusNameOf(task, api.statusById);
  const groups = statusesByCategory(api.statusesForBucket(task.bucketId))
    .map((g) => ({
      ...g,
      statuses: g.statuses.filter((s) => !s.hidden || s.id === task.statusId),
    }))
    .filter((g) => g.statuses.length > 0);
  const byName = groups.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue icon={<StatusIcon category={category} />} aria-label={`Status: ${name}`}>
          {name}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={byName ? (task.statusId ?? "") : category}
          onValueChange={(v) => {
            if (byName) api.setTaskStatus(task.id, { statusId: v });
            else api.setTaskStatus(task.id, { category: v as TaskStatusCategory });
          }}
        >
          {byName
            ? groups.map((g, i) => (
                <div key={g.category}>
                  {i > 0 ? <DropdownMenuSeparator /> : null}
                  {g.statuses.map((s) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id}>
                      <StatusIcon category={s.category} className="text-muted-foreground" />
                      {s.name}
                    </DropdownMenuRadioItem>
                  ))}
                </div>
              ))
            : TASK_STATUS_CATEGORIES.filter((c) => c !== "backlog" || api.statuses.length > 0).map(
                (c) => (
                  <DropdownMenuRadioItem key={c} value={c}>
                    <StatusIcon category={c} className="text-muted-foreground" />
                    {CATEGORY_LABELS[c]}
                  </DropdownMenuRadioItem>
                ),
              )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The assignee picker: you ("Name (you)", MOD-137) · members · Unassigned
 * (viewers greyed). Handing
 * an unfiled task (in your Inbox) to someone else asks for a project in the
 * same picker: "Assign to Mike · in [project]", or "Keep unfiled" (20a, AC5.1).
 */
function AssigneeValue({
  task,
  api,
  canEdit,
  projects,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
  projects: Bucket[];
}) {
  const { assignees, byId, currentUserId } = useAssignees();
  const [open, setOpen] = useState(false);
  const [filing, setFiling] = useState<Assignee | null>(null);
  const known = byId(task.assigneeId);
  // A former member reads "Former member", so the value never renders blank.
  const label = known ? known.name : assigneeLabel(task.assigneeId, byId);
  const unassigned = task.assigneeId === null;
  const inInbox = api.inbox?.id === task.bucketId;

  const assign = (id: string | null, bucketId?: string) => {
    setOpen(false);
    setFiling(null);
    if (id === task.assigneeId && !bucketId) return;
    if (id) {
      void previewAssign(bucketId ?? task.bucketId, id).then((msg) => {
        if (msg) toast.message(msg);
      });
    }
    api.patchTask(task.id, bucketId ? { assigneeId: id, bucketId } : { assigneeId: id });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFiling(null);
      }}
    >
      <PopoverTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={unassigned}
          icon={known ? <AssigneeAvatar assignee={known} size="icon" /> : <User />}
          aria-label={`Assignee: ${label}`}
        >
          {label}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        {filing ? (
          <Command>
            <p className="px-3 pt-2.5 font-sans text-xs text-muted-foreground">
              Assign to {filing.fullName || filing.name} · in
            </p>
            <CommandInput placeholder="Project…" />
            <CommandList>
              <CommandEmpty>No matching project.</CommandEmpty>
              <CommandGroup>
                {projects.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`${b.name} ${b.id}`}
                    onSelect={() => assign(filing.userId, b.id)}
                  >
                    <span className="min-w-0 flex-1 break-words">{b.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem value="keep unfiled" onSelect={() => assign(filing.userId)}>
                  <Inbox className="text-muted-foreground" aria-hidden />
                  Keep unfiled
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <Command>
            <CommandInput placeholder="Assign to…" />
            <CommandList>
              <CommandEmpty>Nobody by that name.</CommandEmpty>
              <CommandGroup>
                {assignees.map((a) => (
                  <CommandItem
                    key={a.userId}
                    value={`${a.name} ${a.fullName} ${a.isMe ? SELF_KEYWORDS.join(" ") : ""} ${a.userId}`}
                    disabled={!a.canTakeTasks}
                    onSelect={() => {
                      if (inInbox && a.userId !== currentUserId && projects.length > 0) {
                        setFiling(a);
                        return;
                      }
                      assign(a.userId);
                    }}
                  >
                    <AssigneeAvatar assignee={a} size="icon" />
                    <span className="min-w-0 flex-1 break-words">
                      {a.canTakeTasks ? assigneeListName(a) : `${assigneeListName(a)} (view only)`}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem value="unassigned" onSelect={() => assign(null)}>
                  <User className="text-muted-foreground" aria-hidden />
                  Unassigned
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The team a task is routed to, beside its assignee (a rounded square, call 95). */
function TeamValue({ task, api, canEdit }: { task: Task; api: TasksModuleApi; canEdit: boolean }) {
  const team = api.teams.find((t) => t.id === task.teamId) ?? null;
  if (api.teams.length === 0 && !team) return null;
  if (!team && !canEdit) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={!team}
          icon={
            team ? (
              <TeamMark
                name={team.name}
                id={team.id}
                letters={team.mark}
                color={team.color}
                size="icon"
              />
            ) : (
              <Users />
            )
          }
          aria-label={team ? `Team: ${team.name}` : "Route to a team"}
          className={cn(!team && "text-muted-foreground")}
        >
          {team ? team.name : "Team"}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup
          value={task.teamId ?? "none"}
          onValueChange={(v) => api.patchTask(task.id, { teamId: v === "none" ? null : v })}
        >
          {api.teams.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id}>
              <TeamMark name={t.name} id={t.id} letters={t.mark} color={t.color} size="icon" />
              {t.name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="none">No team</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LEVEL_WORD: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

function LevelValue({
  kind,
  value,
  canEdit,
  defaultOpen = false,
  onChange,
}: {
  kind: "priority" | "energy";
  value: EnergyLevel | PriorityLevel | null;
  canEdit: boolean;
  defaultOpen?: boolean;
  onChange: (next: EnergyLevel | PriorityLevel | null) => void;
}) {
  const name = kind === "priority" ? "Priority" : "Energy";
  const glyph = (level: EnergyLevel | PriorityLevel) =>
    kind === "priority" ? (
      <PriorityIcon level={level as PriorityLevel} className="size-icon-sm" />
    ) : (
      <EnergyIcon level={level as EnergyLevel} className="size-icon-sm" />
    );
  // Unset priority is the three bars all faint, as capture's pill draws it
  // (MOD-134), never a flag.
  const emptyIcon =
    kind === "priority" ? <PriorityIcon level={null} className="size-icon-sm" /> : <Zap />;
  return (
    <DropdownMenu defaultOpen={defaultOpen && canEdit}>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={!value}
          icon={value ? glyph(value) : emptyIcon}
          aria-label={`${name}: ${value ? LEVEL_WORD[value] : "none"}`}
        >
          {value ? LEVEL_WORD[value] : `Set ${name.toLowerCase()}`}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={value ?? "none"}
          onValueChange={(v) => onChange(v === "none" ? null : (v as EnergyLevel | PriorityLevel))}
        >
          {[...LEVEL_OPTIONS].reverse().map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value}>
              <span className="flex size-icon-sm items-center text-muted-foreground">
                {glyph(l.value)}
              </span>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="none">
            {kind === "priority" ? (
              <span className="flex size-icon-sm items-center text-muted-foreground">
                <PriorityIcon level={null} className="size-icon-sm" />
              </span>
            ) : null}
            None
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagsValue({ task, api, canEdit }: { task: Task; api: TasksModuleApi; canEdit: boolean }) {
  const taskTags = api.tagsByTask.get(task.id) ?? [];
  return (
    <div className="flex min-h-(--ctrl-h-sm) flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
      {taskTags.map((t) => (
        <TagChip
          key={t.id}
          name={t.name}
          color={t.color}
          size="md"
          onRemove={canEdit ? () => api.toggleTaskTag(task.id, t.id) : undefined}
        />
      ))}
      {canEdit ? (
        <TagPicker
          tags={api.tags}
          selectedIds={taskTags.map((t) => t.id)}
          canEdit={canEdit}
          onToggle={(tagId) => api.toggleTaskTag(task.id, tagId)}
          onCreate={(name) => api.createTagForTask(name, task.id)}
          onRecolor={(tagId, color) => api.setTagColor(tagId, color)}
          onDelete={(tagId) => api.deleteTag(tagId)}
          trigger={
            <PropertyValue
              icon={<Plus />}
              empty
              aria-label="Add tag"
              className={cn(taskTags.length > 0 && "ml-0 px-1")}
            >
              {taskTags.length === 0 ? "Add tag" : null}
            </PropertyValue>
          }
        />
      ) : taskTags.length === 0 ? (
        <span className="font-sans text-sm text-muted-foreground">No tags</span>
      ) : null}
    </div>
  );
}
