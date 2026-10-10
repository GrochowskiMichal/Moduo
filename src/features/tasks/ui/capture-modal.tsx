import {
  CalendarDays,
  Check,
  Clock,
  CornerDownLeft,
  Flag,
  Inbox,
  Repeat,
  Timer,
  User,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { Calendar } from "../../../components/ui/calendar";
import { ChipButton, type ChipButtonProps } from "../../../components/ui/chip";
import { TimeInput } from "../../../components/ui/date-field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Input, NumberInput } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import { assigneeOptions, fromAssigneeValue, toAssigneeValue } from "../assignee-options";
import { useAssignees } from "../assignees";
import { ENERGY_LABELS, type NewTaskFields, PRIORITY_LABELS } from "../helpers";
import type { Bucket, EnergyLevel, PriorityLevel, RecurrenceRule } from "../model";
import { parseCapture } from "../parse/capture-parser";
import {
  RECURRENCE_PRESETS,
  type RecurrencePreset,
  recurrenceFromPreset,
  recurrenceLabel,
} from "../parse/recurrence";
import { AssigneeAvatar } from "./assignee-avatar";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  /** Bucket a captured task lands in by default (current selection, or Inbox). */
  defaultBucketId: string | null;
  onCreate: (fields: Omit<NewTaskFields, "workspaceId" | "position">) => void;
};

/** A field that the parser can fill but the user may override manually. */
type Override<T> = { manual: boolean; value: T };
const auto = <T,>(): Override<T | null> => ({ manual: false, value: null });

const LEVELS: Array<{ value: "low" | "medium" | "high"; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const DURATION_PRESETS = [15, 30, 45, 60, 90];

export function CaptureModal({
  open,
  onOpenChange,
  buckets,
  inbox,
  defaultBucketId,
  onCreate,
}: Props) {
  const [raw, setRaw] = useState("");
  const [description, setDescription] = useState("");
  const [bucketId, setBucketId] = useState<string | null>(defaultBucketId);
  const [priority, setPriority] = useState<PriorityLevel | null>(null);
  const [energy, setEnergy] = useState<EnergyLevel | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [due, setDue] = useState<Override<string | null>>(auto<string>());
  const [scheduled, setScheduled] = useState<Override<string | null>>(auto<string>());
  const [recurrence, setRecurrence] = useState<Override<RecurrenceRule | null>>(
    auto<RecurrenceRule>(),
  );
  const [createMore, setCreateMore] = useState(false);
  const { assignees, currentUserId, byId } = useAssignees();
  // undefined = me (the default, which the backend fills in); null = Unassigned.
  const [assigneeId, setAssigneeId] = useState<string | null | undefined>(undefined);
  const shownAssigneeId = assigneeId === undefined ? currentUserId : assigneeId;
  // The ticked option: me by default (nothing until the session resolves).
  const pickedValue =
    assigneeId === undefined ? (currentUserId ?? "") : toAssigneeValue(assigneeId);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetFields = (keepBucket: boolean) => {
    setRaw("");
    setDescription("");
    setPriority(null);
    setEnergy(null);
    setDuration(null);
    setDue(auto<string>());
    setScheduled(auto<string>());
    setRecurrence(auto<RecurrenceRule>());
    // Every fresh capture starts assigned to me; "Create more" keeps bucket + assignee.
    if (!keepBucket) {
      setBucketId(defaultBucketId);
      setAssigneeId(undefined);
    }
  };

  useEffect(() => {
    if (open) {
      resetFields(false);
      setBucketId(defaultBucketId);
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = useMemo(() => parseCapture(raw), [raw]);

  // Parser fills these unless the user has set them manually.
  const effDue = due.manual ? due.value : parsed.dueDate;
  const effScheduled = scheduled.manual ? scheduled.value : parsed.scheduledAt;
  const effRecurrence = recurrence.manual ? recurrence.value : parsed.recurrence;

  const bucketName = (id: string | null): string => {
    if (!id) return "Bucket";
    if (inbox && id === inbox.id) return "Inbox";
    return buckets.find((b) => b.id === id)?.name ?? "Inbox";
  };

  const submit = () => {
    const title = parsed.title.trim() || raw.trim();
    if (!title) return;
    if (!bucketId) {
      toast.error("Couldn't load your buckets yet — try reloading Tasks.");
      return;
    }
    onCreate({
      bucketId,
      title,
      description: description.trim() || undefined,
      dueDate: effDue,
      // A recurring capture materializes its first occurrence as the scheduled
      // time (spec §5d) — the occurrence IS scheduledAt in the single-row model.
      scheduledAt: effScheduled ?? effRecurrence?.nextOccurrence ?? null,
      recurrence: effRecurrence,
      priority,
      energyLevel: energy,
      durationMinutes: duration,
      assigneeId,
    });
    toast(title, {
      description: summarize(effScheduled, effDue, effRecurrence, bucketName(bucketId)),
    });
    if (createMore) {
      resetFields(true);
      inputRef.current?.focus();
    } else {
      onOpenChange(false);
    }
  };

  const onKeyDownSubmit = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const bucketOptions = inbox
    ? [{ id: inbox.id, name: "Inbox", isSystem: true }, ...buckets.filter((b) => b.id !== inbox.id)]
    : buckets;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        {/* Chromeless, Linear-style: no "New task" band — the title input is the
            top. Header stays for a11y (sr-only); close floats top-right. */}
        <DialogHeader className="sr-only">
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Type a task. Dates and recurrence parse automatically; set any property below.
          </DialogDescription>
        </DialogHeader>
        {/* No tooltip: the dialog focuses this first, for a tick, on open. */}
        <DialogClose asChild>
          <IconButton
            icon={X}
            label="Close"
            tooltip={null}
            className="absolute top-3 right-3 z-10 text-muted-foreground"
          />
        </DialogClose>

        <div className="flex flex-col gap-2 px-4 pt-5 pb-1">
          <Input
            ref={inputRef}
            value={raw}
            placeholder="Task title"
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="h-9 border-0 bg-transparent px-0 font-display text-xl shadow-none focus-visible:ring-0"
          />

          <Textarea
            value={description}
            placeholder="Add description…"
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onKeyDownSubmit}
            className="min-h-9 resize-none border-0 bg-transparent px-0 font-sans text-base shadow-none focus-visible:ring-0"
            rows={2}
          />

          {/* property pills — quiet, everything one click away (secondary font) */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* Bucket */}
            <ListPill
              active
              icon={bucketId === inbox?.id ? Inbox : undefined}
              label={bucketName(bucketId)}
            >
              {bucketOptions.map((b) => (
                <DropdownMenuItem key={b.id} onSelect={() => setBucketId(b.id)}>
                  {b.isSystem ? <Inbox className="size-3.5" /> : null}
                  <span className="truncate">{b.name}</span>
                  {b.id === bucketId ? <Check className="ml-auto size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </ListPill>

            {/* Assignee */}
            <ListPill
              active={shownAssigneeId !== currentUserId}
              icon={
                shownAssigneeId ? (
                  <AssigneeAvatar assignee={byId(shownAssigneeId)} size="icon" />
                ) : (
                  User
                )
              }
              label={
                assigneeId === null ? "Unassigned" : (byId(shownAssigneeId)?.name ?? "Assignee")
              }
            >
              {assigneeOptions(assignees).map((o) => (
                <DropdownMenuItem
                  key={o.value}
                  disabled={o.disabled}
                  onSelect={() => setAssigneeId(fromAssigneeValue(o.value))}
                >
                  {o.assignee ? (
                    <AssigneeAvatar assignee={o.assignee} size="icon" />
                  ) : (
                    <User className="size-4 text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate">{o.label}</span>
                  {o.value === pickedValue ? <Check className="ml-auto size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </ListPill>

            {/* Priority */}
            <ListPill
              active={!!priority}
              icon={Flag}
              label={priority ? PRIORITY_LABELS[priority] : "Priority"}
            >
              <DropdownMenuItem onSelect={() => setPriority(null)}>None</DropdownMenuItem>
              <DropdownMenuSeparator />
              {LEVELS.map((l) => (
                <DropdownMenuItem key={l.value} onSelect={() => setPriority(l.value)}>
                  {l.label}
                  {priority === l.value ? <Check className="ml-auto size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </ListPill>

            {/* Energy */}
            <ListPill
              active={!!energy}
              icon={Zap}
              label={energy ? ENERGY_LABELS[energy] : "Energy"}
            >
              <DropdownMenuItem onSelect={() => setEnergy(null)}>None</DropdownMenuItem>
              <DropdownMenuSeparator />
              {LEVELS.map((l) => (
                <DropdownMenuItem key={l.value} onSelect={() => setEnergy(l.value)}>
                  {l.label}
                  {energy === l.value ? <Check className="ml-auto size-3.5" /> : null}
                </DropdownMenuItem>
              ))}
            </ListPill>

            {/* Scheduled — same pill as the others; token Calendar + time inside */}
            <InputPill
              active={!!effScheduled}
              icon={Clock}
              label={effScheduled ? scheduledLabel(effScheduled) : "Schedule"}
              onClear={effScheduled ? () => setScheduled({ manual: true, value: null }) : undefined}
            >
              <Calendar
                mode="single"
                selected={effScheduled ? new Date(effScheduled) : undefined}
                onSelect={(d) => {
                  if (!d) return setScheduled({ manual: true, value: null });
                  const base = effScheduled ? new Date(effScheduled) : null;
                  const next = new Date(d);
                  next.setHours(base ? base.getHours() : 9, base ? base.getMinutes() : 0, 0, 0);
                  setScheduled({ manual: true, value: next.toISOString() });
                }}
              />
              <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                <Clock className="size-icon-sm text-muted-foreground" aria-hidden />
                <TimeInput
                  value={effScheduled ? new Date(effScheduled).toTimeString().slice(0, 5) : ""}
                  onValueChange={(hhmm) => {
                    const [h, m] = hhmm.split(":").map(Number);
                    const base = effScheduled ? new Date(effScheduled) : new Date();
                    base.setHours(h || 0, m || 0, 0, 0);
                    setScheduled({ manual: true, value: base.toISOString() });
                  }}
                  aria-label="Scheduled time"
                />
              </div>
            </InputPill>

            {/* Due */}
            <InputPill
              active={!!effDue}
              icon={CalendarDays}
              label={effDue ? `Due ${dateLabel(effDue)}` : "Due"}
              onClear={effDue ? () => setDue({ manual: true, value: null }) : undefined}
            >
              <Calendar
                mode="single"
                selected={effDue ? new Date(effDue) : undefined}
                onSelect={(d) =>
                  setDue({
                    manual: true,
                    value: d
                      ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
                      : null,
                  })
                }
              />
            </InputPill>

            {/* Recurrence */}
            <ListPill
              active={!!effRecurrence}
              icon={Repeat}
              label={effRecurrence ? recurrenceLabel(effRecurrence) : "Repeat"}
            >
              <DropdownMenuItem onSelect={() => setRecurrence({ manual: true, value: null })}>
                None
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {RECURRENCE_PRESETS.map((p) => (
                <DropdownMenuItem
                  key={p.value}
                  onSelect={() =>
                    setRecurrence({
                      manual: true,
                      value: recurrenceFromPreset(p.value as RecurrencePreset, effScheduled),
                    })
                  }
                >
                  {p.label}
                </DropdownMenuItem>
              ))}
            </ListPill>

            {/* Duration */}
            <InputPill
              active={!!duration}
              icon={Timer}
              label={duration ? `${duration} min` : "Duration"}
              onClear={duration ? () => setDuration(null) : undefined}
            >
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Duration (minutes)
              </label>
              <NumberInput
                min={0}
                step={5}
                autoFocus
                aria-label="Duration (minutes)"
                value={duration}
                onValueChange={setDuration}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {DURATION_PRESETS.map((m) => (
                  <ChipButton
                    key={m}
                    size="xs"
                    active={duration === m}
                    onClick={() => setDuration(m)}
                  >
                    {m}m
                  </ChipButton>
                ))}
              </div>
            </InputPill>
          </div>
        </div>

        {/* footer — secondary font; attachment placeholder (cross-module links) */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <label className="flex items-center gap-2 font-sans text-xs text-muted-foreground">
            <Switch checked={createMore} onCheckedChange={setCreateMore} />
            Create more
          </label>
          <Button size="sm" onClick={submit} disabled={!raw.trim()}>
            Create
            {/* The kit key badge, tuned to sit on the primary fill. */}
            <Kbd className="flex items-center border-primary-foreground/25 bg-transparent py-0 text-primary-foreground/80">
              <CornerDownLeft className="size-icon-xs" aria-hidden />
            </Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── pills ─────────────────────────────────────────────────────────────────────

// Every pill is the kit's ChipButton (DS-6): the hairline at rest, the neutral
// active fill once its field is set, the field's name muted while unset.

/** Pill backed by a dropdown list of choices (auto-closes on select). */
function ListPill({
  active,
  icon,
  label,
  children,
}: {
  active: boolean;
  icon: ChipButtonProps["icon"];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ChipButton
          active={active}
          icon={icon}
          className={cn("max-w-48", !active && "text-muted-foreground")}
        >
          {label}
        </ChipButton>
      </DropdownMenuTrigger>
      {/* lift above the dialog (z-dialog 60); default dropdown z is below it */}
      <DropdownMenuContent
        align="start"
        className="min-w-44"
        style={{ zIndex: "var(--z-popover)" }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Pill backed by a popover with an input (stays open while editing). A set
 * pill carries a × inside its edge: a sibling control laid over the chip's
 * end padding, never a button inside the trigger button.
 */
function InputPill({
  active,
  icon,
  label,
  onClear,
  children,
}: {
  active: boolean;
  icon: ChipButtonProps["icon"];
  label: string;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-flex max-w-48">
      <Popover>
        <PopoverTrigger asChild>
          <ChipButton
            active={active}
            icon={icon}
            className={cn(!active && "text-muted-foreground", onClear && "pe-6")}
          >
            {label}
          </ChipButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          {children}
        </PopoverContent>
      </Popover>
      {onClear ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={onClear}
          className={cn(
            "hit-min absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center rounded-sm text-muted-foreground outline-none",
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          <X aria-hidden className="size-icon-sm" />
        </button>
      ) : null}
    </span>
  );
}

// ── labels ────────────────────────────────────────────────────────────────────

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const DATETIME_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function isToday(d: Date): boolean {
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}
function scheduledLabel(iso: string): string {
  const d = new Date(iso);
  return isToday(d) ? `Today ${TIME_FMT.format(d)}` : DATETIME_FMT.format(d);
}
function dateLabel(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}
function summarize(
  scheduledAt: string | null,
  dueDate: string | null,
  recurrence: RecurrenceRule | null,
  bucket: string,
): string {
  const parts: string[] = [];
  if (scheduledAt) parts.push(scheduledLabel(scheduledAt));
  else if (dueDate) parts.push(`due ${dateLabel(dueDate)}`);
  if (recurrence) parts.push(recurrenceLabel(recurrence));
  return parts.length ? `${parts.join(" · ")} · in ${bucket}` : `Added to ${bucket}`;
}
