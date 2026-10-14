// The detail panel's properties (Tasks v3 §9, research views-board-detail
// §8). Every value starts at the same x behind a 14px icon slot and edits in
// place through one picker (no chevrons; hover shows the field). Status,
// Assignee + Team, Priority, Due and Tags always show; Energy, Scheduled,
// Reminder, Estimate, Repeat and Waiting on show once set, and until then
// sit in one quiet "+" line that names them on one line, "+n" for what
// doesn't fit (MOD-114). The line opens a menu of them all; picking one shows
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
  Flag,
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
import { useLayoutEffect, useRef, useState } from "react";
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
  DropdownMenuItem,
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
import { type Assignee, assigneeLabel } from "../assignee-options";
import { previewAssign, useAssignees } from "../assignees";
import { dueDayOf } from "../bulk";
import {
  namesThatFit,
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
      {quiet.length > 0 ? <AddPropertyLine properties={quiet} onPick={reveal} /> : null}
    </div>
  );
}

// ── the "+" line ──────────────────────────────────────────────────────────────

const PROPERTY_ICONS: Record<OptionalProperty, LucideIcon> = {
  energy: Zap,
  scheduled: CalendarClock,
  reminder: Bell,
  estimate: Timer,
  repeat: Repeat,
  waiting: Hourglass,
};

/**
 * "+ Energy · Scheduled · Reminder · +3" (MOD-114, round-2b `.addprop`): the
 * hidden properties as quiet text on one line that never wraps, whole names
 * then "+n" (call 42). The whole line is one control: it opens a menu with
 * every hidden property, and picking one adds its row. A hidden copy of the
 * names (clipped, so it never widens the panel) gives their widths.
 */
function AddPropertyLine({
  properties,
  onPick,
}: {
  properties: OptionalProperty[];
  onPick: (p: OptionalProperty) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const namesRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(properties.length);
  // The last count set, so a re-measure that changes nothing draws nothing.
  const fitRef = useRef(fit);
  // A pick opens its row's editor, which takes focus: the menu mustn't hand
  // it back to this line as it closes (gotchas/ui.md, SH-1's capture).
  const picked = useRef(false);
  const key = properties.join(" ");

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the names change
  useLayoutEffect(() => {
    const box = boxRef.current;
    const button = buttonRef.current;
    const names = namesRef.current;
    const measure = measureRef.current;
    if (!box || !button || !names || !measure) return;
    const run = () => {
      const widths = [...measure.querySelectorAll<HTMLElement>("[data-name]")].map(
        (el) => el.offsetWidth,
      );
      const more = measure.querySelector<HTMLElement>("[data-more]")?.offsetWidth ?? 0;
      // The "+" and the button's padding take the rest of the line.
      const chrome = button.offsetWidth - names.offsetWidth;
      const room = box.clientWidth > 0 ? box.clientWidth - chrome : 0;
      const next = namesThatFit(room, widths, more);
      if (next !== fitRef.current) {
        fitRef.current = next;
        setFit(next);
      }
    };
    run();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(run);
    observer.observe(box);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [key]);

  const shown = properties.slice(0, Math.min(fit, properties.length));
  const rest = properties.length - shown.length;
  const names = (list: OptionalProperty[], measuring: boolean) =>
    list.map((p, i) => (
      <span key={p} data-name={measuring ? p : undefined} className="shrink-0">
        {i > 0 ? (
          <span aria-hidden className="px-1">
            ·
          </span>
        ) : null}
        {OPTIONAL_PROPERTY_LABELS[p]}
      </span>
    ));

  return (
    <div ref={boxRef} className="relative flex min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label="Add a property"
            className={cn(
              // PropertyValue's quiet control on the sm rung (round-2b `.addprop`).
              // It pulls out 4 px, not 6: the panel's scroll box pads 4, and
              // more would clip the hover fill.
              "-ml-1 flex min-h-(--ctrl-h-sm) min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-0.5",
              "font-sans text-sm text-subtle-foreground outline-none",
              "transition-colors duration-(--motion-fade) ease-(--ease-out)",
              "hover:bg-state-hover hover:text-foreground aria-expanded:bg-state-active aria-expanded:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            <Plus className="size-icon-sm shrink-0" aria-hidden />
            <span
              ref={namesRef}
              data-slot="add-property-names"
              className="flex min-w-0 items-center overflow-hidden whitespace-nowrap"
            >
              {names(shown, false)}
              {rest > 0 ? <span className="shrink-0 ps-1.5 tabular-nums">+{rest}</span> : null}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-48"
          onCloseAutoFocus={(e) => {
            if (!picked.current) return;
            picked.current = false;
            e.preventDefault();
          }}
        >
          {properties.map((p) => {
            const Icon = PROPERTY_ICONS[p];
            return (
              <DropdownMenuItem
                key={p}
                onSelect={() => {
                  picked.current = true;
                  onPick(p);
                }}
              >
                <Icon aria-hidden />
                {OPTIONAL_PROPERTY_LABELS[p]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The widths: every name and a "+n", laid out but unseen and clipped. */}
      <span aria-hidden className="pointer-events-none invisible absolute size-0 overflow-hidden">
        <span ref={measureRef} className="flex w-max font-sans text-sm whitespace-nowrap">
          {names(properties, true)}
          <span data-more className="shrink-0 ps-1.5 tabular-nums">
            +{properties.length}
          </span>
        </span>
      </span>
    </div>
  );
}

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
 * The assignee picker: Me · members · Unassigned (viewers greyed). Handing
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
                    value={`${a.name} ${a.fullName} ${a.userId}`}
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
                      {a.canTakeTasks ? a.name : `${a.name} (view only)`}
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
  const emptyIcon = kind === "priority" ? <Flag /> : <Zap />;
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
          <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TagsValue({ task, api, canEdit }: { task: Task; api: TasksModuleApi; canEdit: boolean }) {
  const taskTags = api.tagsByTask.get(task.id) ?? [];
  return (
    <div className="flex min-h-(--ctrl-h-sm) flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
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
