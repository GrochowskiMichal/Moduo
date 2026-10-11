// The capture's pills (tasks-v3 call 91): Assign (people and teams) · Due ·
// Tags · Priority · ⋯ More (scheduled, reminder, estimate, repeat, waiting on,
// template). Each shows what the title's tokens or a hand pick set; a pick by
// hand wins over a token, which then falls back to words (research §2). What
// More holds joins the row once set, as a chip with ×.

import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  Flag,
  Hash,
  Hourglass,
  MoreHorizontal,
  Repeat,
  Timer,
  User,
} from "lucide-react";
import { PersonAvatar, TeamMark } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { Chip, ChipButton, PickerPill } from "../../../components/ui/chip";
import { DateField, DatePickerPanel, useDateDraft } from "../../../components/ui/date-field";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { formatDay, formatDayTime } from "../../../lib/time-format";
import { isoDay } from "../../spine/grammar";
import type { PriorityLevel, RecurrenceRule, Tag, Team } from "../model";
import { RECURRENCE_PRESETS, recurrenceFromPreset, recurrenceLabel } from "../parse/recurrence";
import { estimateLabel } from "./capture-menus";

export type PillPerson = { userId: string; name: string; isMe: boolean; canTakeTasks: boolean };

/** What the pills show (tokens and hand picks merged by the body). */
export type PillValues = {
  /** Undefined: you (unset). Null: Unassigned. */
  assigneeId: string | null | undefined;
  teamId: string | null;
  dueDay: string | null;
  scheduledAt: string | null;
  recurrence: RecurrenceRule | null;
  priority: PriorityLevel | null;
  estimateMinutes: number | null;
  remindAt: string | null;
  tags: Array<{ id: string | null; name: string; color?: string | null }>;
  waitingOn: string[];
};

/** A hand pick, by field. */
export type PillChange =
  | { field: "assignee"; value: string | null | undefined }
  | { field: "team"; value: string | null }
  | { field: "due"; value: string | null }
  | { field: "schedule"; value: string | null }
  | { field: "repeat"; value: RecurrenceRule | null }
  | { field: "priority"; value: PriorityLevel | null }
  | { field: "estimate"; value: number | null }
  | { field: "remind"; value: string | null }
  | { field: "tag"; tag: { id: string; name: string; color?: string | null }; on: boolean }
  | { field: "waiting"; userId: string; on: boolean };

export type OpenPill = "assign" | "due" | "tags" | "priority" | "more" | null;

type Props = {
  values: PillValues;
  people: readonly PillPerson[];
  teams: readonly Team[];
  tags: readonly Tag[];
  me: string | null;
  onChange: (change: PillChange) => void;
  open: OpenPill;
  onOpenChange: (open: OpenPill) => void;
  /** "Template…" in More, when templates exist (TV-D15). */
  onTemplate?: () => void;
};

const PRIORITIES: Array<{ level: PriorityLevel; label: string }> = [
  { level: "high", label: "High" },
  { level: "medium", label: "Medium" },
  { level: "low", label: "Low" },
];

const ESTIMATES = [15, 30, 60, 120, 240];

const dayDate = (day: string) => new Date(`${day}T00:00:00`);

function nameOf(people: readonly PillPerson[], id: string | null | undefined): string {
  return people.find((p) => p.userId === id)?.name ?? "Someone";
}

export function CapturePills({
  values,
  people,
  teams,
  tags,
  me,
  onChange,
  open,
  onOpenChange,
  onTemplate,
}: Props) {
  const team = teams.find((t) => t.id === values.teamId) ?? null;
  const assigneeId = values.assigneeId === undefined ? me : values.assigneeId;
  const someoneElse = assigneeId && assigneeId !== me ? assigneeId : null;
  const toggle = (pill: Exclude<OpenPill, null>) => (next: boolean) =>
    onOpenChange(next ? pill : null);

  // Assign: a person (round), a team (square), or both.
  const assignValue =
    someoneElse || team ? (
      <span className="flex min-w-0 items-center gap-1.5">
        {someoneElse ? <PersonAvatar name={nameOf(people, someoneElse)} id={someoneElse} /> : null}
        {team ? <TeamMark name={team.name} id={team.id} letters={team.mark || null} /> : null}
        <span className="truncate">
          {someoneElse
            ? team
              ? `${nameOf(people, someoneElse)} · ${team.name}`
              : nameOf(people, someoneElse)
            : `${team?.name} · unclaimed`}
        </span>
      </span>
    ) : values.assigneeId === null ? (
      "Unassigned"
    ) : null;

  const dueDraft = useDateDraft({
    value: values.dueDay ? dayDate(values.dueDay) : null,
    onChange: (d) => onChange({ field: "due", value: d ? isoDay(d) : null }),
    withTime: false,
    open: open === "due",
    done: () => onOpenChange(null),
  });

  const tagNames = values.tags.map((t) => t.name);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <PickerPill
        label="Assign"
        icon={someoneElse || team ? undefined : User}
        value={assignValue}
        open={open === "assign"}
        onOpenChange={toggle("assign")}
        contentClassName="min-w-56"
        content={
          <>
            {people.map((p) => (
              <DropdownMenuItem
                key={p.userId}
                disabled={!p.canTakeTasks}
                onSelect={() =>
                  onChange({ field: "assignee", value: p.isMe ? undefined : p.userId })
                }
              >
                <PersonAvatar name={p.name} id={p.userId} />
                <span className="truncate">{p.isMe ? `${p.name} (you)` : p.name}</span>
                {assigneeId === p.userId ? <Check className="ms-auto" aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => onChange({ field: "assignee", value: null })}>
              <User className="text-muted-foreground" aria-hidden />
              Unassigned
              {values.assigneeId === null ? <Check className="ms-auto" aria-hidden /> : null}
            </DropdownMenuItem>
            {teams.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Teams</DropdownMenuLabel>
                {teams.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onSelect={() =>
                      onChange({ field: "team", value: values.teamId === t.id ? null : t.id })
                    }
                  >
                    <TeamMark name={t.name} id={t.id} letters={t.mark || null} />
                    <span className="truncate">{t.name}</span>
                    {values.teamId === t.id ? <Check className="ms-auto" aria-hidden /> : null}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </>
        }
      />
      <Popover
        open={open === "due"}
        onOpenChange={(next) => (next ? onOpenChange("due") : dueDraft.close())}
      >
        <PopoverTrigger asChild>
          <ChipButton
            icon={CalendarDays}
            active={Boolean(values.dueDay)}
            className={values.dueDay ? undefined : "text-muted-foreground"}
          >
            {values.dueDay ? (
              <>
                <span className="sr-only">Due: </span>
                {formatDay(dayDate(values.dueDay))}
              </>
            ) : (
              "Due"
            )}
          </ChipButton>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" onEscapeKeyDown={dueDraft.cancel}>
          <DatePickerPanel draft={dueDraft} />
        </PopoverContent>
      </Popover>
      <PickerPill
        label="Tags"
        icon={Hash}
        value={
          tagNames.length
            ? tagNames.slice(0, 2).join(", ") +
              (tagNames.length > 2 ? ` +${tagNames.length - 2}` : "")
            : null
        }
        open={open === "tags"}
        onOpenChange={toggle("tags")}
        contentClassName="min-w-48"
        content={
          tags.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Type # in the title to make a tag.
            </p>
          ) : (
            tags.map((t) => {
              const on = values.tags.some((x) => x.id === t.id);
              return (
                <DropdownMenuCheckboxItem
                  key={t.id}
                  checked={on}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(checked) =>
                    onChange({
                      field: "tag",
                      tag: { id: t.id, name: t.name, color: t.color },
                      on: checked === true,
                    })
                  }
                >
                  <span
                    data-label={t.color ?? "gray"}
                    className="tag-dot size-2 shrink-0 rounded-full"
                    aria-hidden
                  />
                  <span className="truncate">{t.name}</span>
                </DropdownMenuCheckboxItem>
              );
            })
          )
        }
      />
      <PickerPill
        label="Priority"
        icon={Flag}
        value={values.priority ? PRIORITIES.find((p) => p.level === values.priority)?.label : null}
        open={open === "priority"}
        onOpenChange={toggle("priority")}
        content={
          <>
            {PRIORITIES.map((p) => (
              <DropdownMenuItem
                key={p.level}
                onSelect={() => onChange({ field: "priority", value: p.level })}
              >
                <Flag className="text-muted-foreground" aria-hidden />
                {p.label}
                {values.priority === p.level ? <Check className="ms-auto" aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange({ field: "priority", value: null })}>
              No priority
            </DropdownMenuItem>
          </>
        }
      />
      <MorePill
        values={values}
        people={people}
        me={me}
        onChange={onChange}
        open={open === "more"}
        onOpenChange={toggle("more")}
        onTemplate={onTemplate}
      />
      <MoreChips values={values} people={people} onChange={onChange} />
    </div>
  );
}

/** What More holds, once set, as chips in the row (each with ×). */
function MoreChips({
  values,
  people,
  onChange,
}: {
  values: PillValues;
  people: readonly PillPerson[];
  onChange: (change: PillChange) => void;
}) {
  const chips: Array<{ key: string; icon: typeof Bell; label: string; clear: () => void }> = [];
  if (values.scheduledAt)
    chips.push({
      key: "schedule",
      icon: CalendarClock,
      label: formatDayTime(values.scheduledAt),
      clear: () => onChange({ field: "schedule", value: null }),
    });
  if (values.remindAt)
    chips.push({
      key: "remind",
      icon: Bell,
      label: `Remind ${formatDayTime(values.remindAt)}`,
      clear: () => onChange({ field: "remind", value: null }),
    });
  if (values.estimateMinutes)
    chips.push({
      key: "estimate",
      icon: Timer,
      label: estimateLabel(values.estimateMinutes),
      clear: () => onChange({ field: "estimate", value: null }),
    });
  if (values.recurrence)
    chips.push({
      key: "repeat",
      icon: Repeat,
      label: capitalise(recurrenceLabel(values.recurrence)),
      clear: () => onChange({ field: "repeat", value: null }),
    });
  for (const id of values.waitingOn)
    chips.push({
      key: `waiting:${id}`,
      icon: Hourglass,
      label: `Waiting on ${nameOf(people, id)}`,
      clear: () => onChange({ field: "waiting", userId: id, on: false }),
    });
  return (
    <>
      {chips.map((c) => (
        <Chip key={c.key} active icon={c.icon} onRemove={c.clear} removeLabel={`Clear ${c.label}`}>
          {c.label}
        </Chip>
      ))}
    </>
  );
}

function MorePill({
  values,
  people,
  me,
  onChange,
  open,
  onOpenChange,
  onTemplate,
}: {
  values: PillValues;
  people: readonly PillPerson[];
  me: string | null;
  onChange: (change: PillChange) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplate?: () => void;
}) {
  const row = "flex items-center gap-2 px-2 py-1.5";
  const label = "w-20 shrink-0 font-sans text-sm text-muted-foreground";
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <ChipButton icon={MoreHorizontal} className="text-muted-foreground" aria-label="More">
          More
        </ChipButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <div className={row}>
          <span className={label}>Scheduled</span>
          <DateField
            withTime
            value={values.scheduledAt ? new Date(values.scheduledAt) : null}
            onChange={(d) => onChange({ field: "schedule", value: d ? d.toISOString() : null })}
            placeholder="Pick a time"
            aria-label="Scheduled"
          />
        </div>
        <div className={row}>
          <span className={label}>Reminder</span>
          <DateField
            withTime
            icon={<Bell aria-hidden />}
            value={values.remindAt ? new Date(values.remindAt) : null}
            onChange={(d) => onChange({ field: "remind", value: d ? d.toISOString() : null })}
            placeholder="Remind me at…"
            aria-label="Reminder"
          />
        </div>
        <div className={row}>
          <span className={label}>Estimate</span>
          <div className="flex flex-wrap gap-1">
            {ESTIMATES.map((m) => (
              <ChipButton
                key={m}
                size="xs"
                active={values.estimateMinutes === m}
                onClick={() =>
                  onChange({ field: "estimate", value: values.estimateMinutes === m ? null : m })
                }
              >
                {estimateLabel(m).slice(1)}
              </ChipButton>
            ))}
          </div>
        </div>
        <div className={row}>
          <span className={label}>Repeat</span>
          <div className="flex flex-wrap gap-1">
            {RECURRENCE_PRESETS.map((p) => {
              const on = values.recurrence
                ? recurrenceLabel(values.recurrence) ===
                  recurrenceLabel(recurrenceFromPreset(p.value))
                : false;
              return (
                <ChipButton
                  key={p.value}
                  size="xs"
                  active={on}
                  onClick={() =>
                    onChange({
                      field: "repeat",
                      value: on ? null : recurrenceFromPreset(p.value, values.scheduledAt),
                    })
                  }
                >
                  {p.label}
                </ChipButton>
              );
            })}
          </div>
        </div>
        <div className={row}>
          <span className={label}>Waiting on</span>
          <div className="flex flex-wrap gap-1">
            {people
              .filter((p) => p.userId !== me)
              .slice(0, 8)
              .map((p) => {
                const on = values.waitingOn.includes(p.userId);
                return (
                  <ChipButton
                    key={p.userId}
                    size="xs"
                    active={on}
                    icon={<PersonAvatar name={p.name} id={p.userId} />}
                    onClick={() => onChange({ field: "waiting", userId: p.userId, on: !on })}
                  >
                    {p.name}
                  </ChipButton>
                );
              })}
          </div>
        </div>
        {onTemplate ? (
          <div className="border-t border-hairline p-1">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onTemplate}>
              Template…
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
