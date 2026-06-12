// Right-rail task inspector: shows the selected task's editable description and
// all of its properties, plus ambient mirrors (drift, reschedule count) and
// created/updated metadata. Mutations go through api.patchTask (optimistic) —
// no new write paths. Mirrors, never walls: ambient info is factual and quiet,
// never red / alarming (spec §10 design principles 4 & 5).

import { useState } from "react";
import { CalendarClock, Clock, Hourglass, Inbox, Repeat, RotateCcw, Sunrise } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Separator } from "../../../components/ui/separator";
import { Textarea } from "../../../components/ui/textarea";
import {
  ENERGY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  toDateInputValue,
  toLocalInputValue,
} from "../helpers";
import {
  isDrifted,
  type Bucket,
  type EnergyLevel,
  type PriorityLevel,
  type Task,
  type TaskStatus,
} from "../model";
import type { TasksModuleApi } from "../hooks/use-tasks-module";

type Props = {
  task: Task | null;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onRequestCapture: () => void;
  api: TasksModuleApi;
};

const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "done", "archived"];
const LEVELS: Array<EnergyLevel | PriorityLevel> = ["low", "medium", "high"];
const NONE = "none";

const META_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : META_FMT.format(d);
}

export function TaskDetailPanel({ task, buckets, inbox, canEdit, onRequestCapture, api }: Props) {
  if (!task) return <DetailEmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />;
  // Key on id so every local draft (title / description / duration) resets when
  // the selection changes.
  return <DetailBody key={task.id} task={task} buckets={buckets} inbox={inbox} canEdit={canEdit} api={api} />;
}

function DetailBody({
  task,
  buckets,
  inbox,
  canEdit,
  api,
}: {
  task: Task;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  api: TasksModuleApi;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [duration, setDuration] = useState(task.durationMinutes != null ? String(task.durationMinutes) : "");

  const drifted = isDrifted(task);
  const committed = !!task.committedFor && task.committedFor === api.today;
  const bucketOptions = inbox ? [inbox, ...buckets.filter((b) => b.id !== inbox.id)] : buckets;

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) api.patchTask(task.id, { title: next });
    else if (!next) setTitle(task.title); // refuse empty — restore
  };
  const commitDescription = () => {
    if (description !== task.description) api.patchTask(task.id, { description });
  };
  const commitDuration = () => {
    const n = Number.parseInt(duration, 10);
    const next = Number.isFinite(n) && n > 0 ? n : null;
    if (next !== task.durationMinutes) api.patchTask(task.id, { durationMinutes: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {/* title + complete */}
        <Input
          value={title}
          disabled={!canEdit}
          aria-label="Task title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setTitle(task.title);
              e.currentTarget.blur();
            }
          }}
          className="border-transparent bg-transparent px-0 font-display text-base text-foreground"
        />

        {/* description */}
        <Field label="Description">
          <Textarea
            value={description}
            disabled={!canEdit}
            placeholder={canEdit ? "Add a description…" : undefined}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
            className="min-h-16 text-sm"
          />
        </Field>

        <Separator />

        {/* properties */}
        <div className="space-y-3">
          <Field label="Status">
            <Select
              value={task.status}
              disabled={!canEdit}
              onValueChange={(v) => api.patchTask(task.id, { status: v as TaskStatus })}
            >
              <SelectTrigger size="sm" className="w-full font-display">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Bucket">
            <Select
              value={task.bucketId}
              disabled={!canEdit}
              onValueChange={(v) => {
                if (v !== task.bucketId) api.patchTask(task.id, { bucketId: v });
              }}
            >
              <SelectTrigger size="sm" className="w-full font-display">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bucketOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      {b.isSystem ? <Inbox className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Scheduled">
              <Input
                type="datetime-local"
                disabled={!canEdit}
                defaultValue={toLocalInputValue(task.scheduledAt)}
                className="h-8"
                onChange={(e) => {
                  const v = e.target.value;
                  api.patchTask(task.id, { scheduledAt: v ? new Date(v).toISOString() : null });
                }}
              />
            </Field>
            <Field label="Due">
              <Input
                type="date"
                disabled={!canEdit}
                defaultValue={toDateInputValue(task.dueDate)}
                className="h-8"
                onChange={(e) => {
                  const v = e.target.value;
                  api.patchTask(task.id, { dueDate: v ? new Date(`${v}T00:00:00`).toISOString() : null });
                }}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <LevelSelect
                value={task.priority}
                disabled={!canEdit}
                labels={PRIORITY_LABELS}
                onChange={(v) => api.patchTask(task.id, { priority: v })}
              />
            </Field>
            <Field label="Energy">
              <LevelSelect
                value={task.energyLevel}
                disabled={!canEdit}
                labels={ENERGY_LABELS}
                onChange={(v) => api.patchTask(task.id, { energyLevel: v })}
              />
            </Field>
          </div>

          <Field label="Duration">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                disabled={!canEdit}
                value={duration}
                placeholder="—"
                onChange={(e) => setDuration(e.target.value)}
                onBlur={commitDuration}
                className="h-8 w-24"
              />
              <span className="text-xs text-muted-foreground">minutes</span>
            </div>
          </Field>

          {task.recurrence ? (
            <Field label="Recurrence">
              <span className="flex items-center gap-1.5 text-sm text-foreground">
                <Repeat className="size-3.5 text-muted-foreground" aria-hidden />
                {task.recurrence.rrule}
              </span>
            </Field>
          ) : null}

          {canEdit ? (
            <Button
              type="button"
              variant={committed ? "secondary" : "outline"}
              size="sm"
              className="w-full justify-center"
              onClick={() => api.toggleCommit(task.id)}
            >
              <Sunrise className="size-3.5" aria-hidden />
              {committed ? "Remove from today" : "Commit to today"}
            </Button>
          ) : null}
        </div>

        {/* ambient mirrors — quiet, factual, never alarming (principles 4 & 5) */}
        {drifted || task.rescheduleCount > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {drifted ? (
                <Mirror icon={<Clock className="size-3.5" aria-hidden />}>
                  Drifted — its scheduled time has passed.
                </Mirror>
              ) : null}
              {task.rescheduleCount > 0 ? (
                <Mirror icon={<RotateCcw className="size-3.5" aria-hidden />}>
                  Rescheduled {task.rescheduleCount}
                  {"×"}
                </Mirror>
              ) : null}
            </div>
          </>
        ) : null}

        <Separator />

        {/* metadata */}
        <div className="space-y-1 text-2xs text-muted-foreground/80">
          <Meta term="Created" icon={<CalendarClock className="size-3 opacity-70" aria-hidden />}>
            {formatTimestamp(task.createdAt)}
          </Meta>
          <Meta term="Updated" icon={<Hourglass className="size-3 opacity-70" aria-hidden />}>
            {formatTimestamp(task.updatedAt)}
          </Meta>
        </div>
      </div>
    </div>
  );
}

// ── empty / teaching state ─────────────────────────────────────────────────────

function DetailEmptyState({
  canEdit,
  onRequestCapture,
}: {
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
      <p className="font-display text-sm text-foreground">No task selected</p>
      <p className="text-xs text-muted-foreground">Pick a task to see and edit its details here.</p>
      {canEdit ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Press <Kbd>c</Kbd> to{" "}
          <button
            type="button"
            onClick={onRequestCapture}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            capture
          </button>{" "}
          a new one.
        </p>
      ) : null}
    </div>
  );
}

// ── small building blocks ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="block font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function LevelSelect({
  value,
  disabled,
  labels,
  onChange,
}: {
  value: EnergyLevel | PriorityLevel | null;
  disabled: boolean;
  labels: Record<EnergyLevel | PriorityLevel, string>;
  onChange: (next: EnergyLevel | PriorityLevel | null) => void;
}) {
  return (
    <Select
      value={value ?? NONE}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NONE ? null : (v as EnergyLevel | PriorityLevel))}
    >
      <SelectTrigger size="sm" className="w-full font-display">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>None</SelectItem>
        {LEVELS.map((l) => (
          <SelectItem key={l} value={l}>
            {labels[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Mirror({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      {children}
    </span>
  );
}

function Meta({
  term,
  icon,
  children,
}: {
  term: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 tabular-nums">
      {icon}
      <span>
        {term} {children}
      </span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-2xs text-muted-foreground">
      {children}
    </kbd>
  );
}
