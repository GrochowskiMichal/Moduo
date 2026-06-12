import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock,
  CornerDownLeft,
  Flag,
  Inbox,
  Paperclip,
  Repeat,
  Timer,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
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
import { Input } from "../../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import {
  ENERGY_LABELS,
  PRIORITY_LABELS,
  toDateInputValue,
  toLocalInputValue,
  type NewTaskFields,
} from "../helpers";
import {
  RECURRENCE_PRESETS,
  recurrenceFromPreset,
  recurrenceLabel,
  type RecurrencePreset,
} from "../parse/recurrence";
import { parseCapture } from "../parse/capture-parser";
import type { Bucket, EnergyLevel, PriorityLevel, RecurrenceRule } from "../model";

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

export function CaptureModal({ open, onOpenChange, buckets, inbox, defaultBucketId, onCreate }: Props) {
  const [raw, setRaw] = useState("");
  const [description, setDescription] = useState("");
  const [bucketId, setBucketId] = useState<string | null>(defaultBucketId);
  const [priority, setPriority] = useState<PriorityLevel | null>(null);
  const [energy, setEnergy] = useState<EnergyLevel | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [due, setDue] = useState<Override<string | null>>(auto<string>());
  const [scheduled, setScheduled] = useState<Override<string | null>>(auto<string>());
  const [recurrence, setRecurrence] = useState<Override<RecurrenceRule | null>>(auto<RecurrenceRule>());
  const [createMore, setCreateMore] = useState(false);
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
    if (!keepBucket) setBucketId(defaultBucketId);
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
    });
    toast.success(title, { description: summarize(effScheduled, effDue, effRecurrence, bucketName(bucketId)) });
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
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border px-4 py-2.5 text-left">
          <DialogTitle className="font-display text-sm font-medium text-foreground">New task</DialogTitle>
          <DialogDescription className="sr-only">
            Type a task. Dates and recurrence parse automatically; set any property below.
          </DialogDescription>
          <DialogClose className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        <div className="flex flex-col gap-2 px-4 pt-3 pb-1">
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
            className="h-9 border-0 bg-transparent px-0 font-display text-lg shadow-none focus-visible:ring-0"
          />

          <Textarea
            value={description}
            placeholder="Add description…"
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onKeyDownSubmit}
            className="min-h-9 resize-none border-0 bg-transparent px-0 font-display text-sm shadow-none focus-visible:ring-0"
            rows={2}
          />

          {/* property pills — quiet, everything one click away (secondary font) */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Bucket */}
          <ListPill
            active
            icon={bucketId === inbox?.id ? <Inbox className="size-3.5" /> : null}
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

          {/* Priority */}
          <ListPill active={!!priority} icon={<Flag className="size-3.5" />} label={priority ? PRIORITY_LABELS[priority] : "Priority"}>
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
          <ListPill active={!!energy} icon={<Zap className="size-3.5" />} label={energy ? ENERGY_LABELS[energy] : "Energy"}>
            <DropdownMenuItem onSelect={() => setEnergy(null)}>None</DropdownMenuItem>
            <DropdownMenuSeparator />
            {LEVELS.map((l) => (
              <DropdownMenuItem key={l.value} onSelect={() => setEnergy(l.value)}>
                {l.label}
                {energy === l.value ? <Check className="ml-auto size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </ListPill>

          {/* Scheduled */}
          <InputPill
            active={!!effScheduled}
            icon={<Clock className="size-3.5" />}
            label={effScheduled ? scheduledLabel(effScheduled) : "Schedule"}
            onClear={effScheduled ? () => setScheduled({ manual: true, value: null }) : undefined}
          >
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Scheduled time</label>
            <Input
              type="datetime-local"
              autoFocus
              defaultValue={toLocalInputValue(effScheduled)}
              className="h-8"
              onChange={(e) =>
                setScheduled({ manual: true, value: e.target.value ? new Date(e.target.value).toISOString() : null })
              }
            />
          </InputPill>

          {/* Due */}
          <InputPill
            active={!!effDue}
            icon={<CalendarDays className="size-3.5" />}
            label={effDue ? `Due ${dateLabel(effDue)}` : "Due"}
            onClear={effDue ? () => setDue({ manual: true, value: null }) : undefined}
          >
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Due date</label>
            <Input
              type="date"
              autoFocus
              defaultValue={toDateInputValue(effDue)}
              className="h-8"
              onChange={(e) =>
                setDue({ manual: true, value: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null })
              }
            />
          </InputPill>

          {/* Recurrence */}
          <ListPill
            active={!!effRecurrence}
            icon={<Repeat className="size-3.5" />}
            label={effRecurrence ? recurrenceLabel(effRecurrence) : "Repeat"}
          >
            <DropdownMenuItem onSelect={() => setRecurrence({ manual: true, value: null })}>None</DropdownMenuItem>
            <DropdownMenuSeparator />
            {RECURRENCE_PRESETS.map((p) => (
              <DropdownMenuItem
                key={p.value}
                onSelect={() => setRecurrence({ manual: true, value: recurrenceFromPreset(p.value as RecurrencePreset, effScheduled) })}
              >
                {p.label}
              </DropdownMenuItem>
            ))}
          </ListPill>

          {/* Duration */}
          <InputPill
            active={!!duration}
            icon={<Timer className="size-3.5" />}
            label={duration ? `${duration} min` : "Duration"}
            onClear={duration ? () => setDuration(null) : undefined}
          >
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Duration (minutes)</label>
            <Input
              type="number"
              min={0}
              step={5}
              autoFocus
              value={duration ?? ""}
              className="h-8"
              onChange={(e) => setDuration(e.target.value ? Math.max(0, parseInt(e.target.value, 10)) : null)}
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {DURATION_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDuration(m)}
                  className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {m}m
                </button>
              ))}
            </div>
          </InputPill>
          </div>
        </div>

        {/* footer — secondary font; attachment placeholder (cross-module links) */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Link items (coming soon)"
              title="Link notes, emails, and more — coming soon"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Paperclip className="size-4" aria-hidden />
            </button>
            <label className="flex items-center gap-2 font-sans text-xs text-muted-foreground">
              <Switch checked={createMore} onCheckedChange={setCreateMore} />
              Create more
            </label>
          </div>
          <Button size="sm" onClick={submit} disabled={!raw.trim()}>
            Create
            <kbd className="flex items-center opacity-80">
              <CornerDownLeft className="size-3" aria-hidden />
            </kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── pills ─────────────────────────────────────────────────────────────────────

function pillCls(active: boolean): string {
  return cn(
    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-border bg-muted text-foreground"
      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

/** Pill backed by a dropdown list of choices (auto-closes on select). */
function ListPill({
  active,
  icon,
  label,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={pillCls(active)}>
        {icon}
        <span className="max-w-40 truncate">{label}</span>
      </DropdownMenuTrigger>
      {/* lift above the dialog (z-dialog 60); default dropdown z is below it */}
      <DropdownMenuContent align="start" className="min-w-44" style={{ zIndex: "var(--z-popover)" }}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pill backed by a popover with an input (stays open while editing). */
function InputPill({
  active,
  icon,
  label,
  onClear,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={pillCls(active)}>
      <Popover>
        <PopoverTrigger className="flex items-center gap-1.5 focus-visible:outline-none">
          {icon}
          <span className="max-w-40 truncate">{label}</span>
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
          className="-mr-0.5 ml-0.5 rounded text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

// ── labels ────────────────────────────────────────────────────────────────────

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const DATETIME_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

function isToday(d: Date): boolean {
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
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
