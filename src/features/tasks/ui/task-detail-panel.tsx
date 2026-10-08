// Right-rail task inspector: shows the selected task's editable description and
// all of its properties, plus ambient mirrors (drift, reschedule count) and
// created/updated metadata. Mutations go through api.patchTask (optimistic) —
// no new write paths. Mirrors, never walls: ambient info is factual and quiet,
// never red / alarming (spec §10 design principles 4 & 5).

import {
  CalendarClock,
  CircleDashed,
  Clock,
  CornerDownRight,
  Hourglass,
  Inbox,
  ListChecks,
  Plus,
  Repeat,
  RotateCcw,
  SkipForward,
  User,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useEntityHub } from "@/features/spine/hooks/use-entity-hub";
import { EntityHub } from "@/features/spine/ui/entity-hub";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { TagChip } from "../../../components/tag-chip";
import { TagPicker } from "../../../components/tag-picker";
import { Button } from "../../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { DateField } from "../../../components/ui/date-field";
import { detailTitleVariants } from "../../../components/ui/detail-title";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Field, Mirror } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { PropertyRow } from "../../../components/ui/property-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Separator } from "../../../components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { EntityTextEditor } from "../../spine/editor/entity-text-editor";
import { activityActorName, activityLine, isTrailEntry } from "../activity";
import {
  assigneeLabel,
  assigneeOptions,
  createdByLabel,
  fromAssigneeValue,
  toAssigneeValue,
} from "../assignee-options";
import { previewAssign, useAssignees } from "../assignees";
import { formatTimestamp, LEVEL_OPTIONS, STATUS_LABELS, wouldCreateCycle } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import {
  type ActivityEntry,
  type Bucket,
  type EnergyLevel,
  isDrifted,
  type PriorityLevel,
  type Task,
  type TaskStatus,
} from "../model";
import {
  RECURRENCE_PRESETS,
  type RecurrencePreset,
  recurrenceFromPreset,
  recurrenceLabel,
} from "../parse/recurrence";
import { AssigneeAvatar } from "./assignee-avatar";

type Props = {
  task: Task | null;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onRequestCapture: () => void;
  /** Move the app-level task selection (subtask ↔ parent navigation). */
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
  /** Spine runtime — when present (with a workspace), the linked-entity hub
   * (DF-8) renders. Optional so callers that don't wire the spine degrade to
   * the plain inspector. */
  runtime?: ModuoRuntime | null;
  workspaceId?: string | null;
  /** Open a linked entity from the hub. Defaults to the app-wide deep-link
   * event; callers that can select in place (Tasks, Calendar, Email, Notes)
   * pass their own. */
  onOpenEntity?: (ref: EntityRef) => void;
};

/**
 * A drag-to-link drop onto the task hub (DF-8) is persisted by the enclosing
 * page's DndContext; it dispatches this so the open task's hub re-pulls without
 * a re-select. Mirrors NO-7b's `NOTE_DETAIL_REFRESH_EVENT`.
 */
export const TASK_DETAIL_REFRESH_EVENT = "moduo:task:detail:refresh";

// Lifecycle order for the status picker (distinct from helpers' STATUS_ORDER,
// which is the open-work-first grouping order).
const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "done", "archived"];

export function TaskDetailPanel({
  task,
  buckets,
  inbox,
  canEdit,
  onRequestCapture,
  onSelectTask,
  api,
  runtime = null,
  workspaceId = null,
  onOpenEntity,
}: Props) {
  if (!task) return <DetailEmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />;
  // Key on id so every local draft (title / description / duration) resets when
  // the selection changes.
  return (
    <DetailBody
      key={task.id}
      task={task}
      buckets={buckets}
      inbox={inbox}
      canEdit={canEdit}
      onSelectTask={onSelectTask}
      api={api}
      runtime={runtime}
      workspaceId={workspaceId}
      onOpenEntity={onOpenEntity}
    />
  );
}

function DetailBody({
  task,
  buckets,
  inbox,
  canEdit,
  onSelectTask,
  api,
  runtime,
  workspaceId,
  onOpenEntity,
}: {
  task: Task;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  onOpenEntity?: (ref: EntityRef) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [duration, setDuration] = useState(
    task.durationMinutes != null ? String(task.durationMinutes) : "",
  );
  // Manual time-spent (minutes) — adjust the persisted total directly. The live
  // tracker lives only in Focus (locked decision 2026-06-16); here you just
  // type/correct the value. Stored as seconds; shown/edited in whole minutes.
  const timeSpentDisplay = task.timeSpentSeconds
    ? String(Math.round(task.timeSpentSeconds / 60))
    : "";
  // Draft only while the field is focused; otherwise the input mirrors the live
  // total (which Focus may accrue into in the background). Seeding the draft once
  // and leaving it would let a bare blur write a stale value over freshly-tracked
  // seconds — see commitTimeSpent.
  const [timeSpent, setTimeSpentDraft] = useState(timeSpentDisplay);
  const [timeSpentEditing, setTimeSpentEditing] = useState(false);

  const drifted = isDrifted(task);
  const committed = !!task.committedFor && task.committedFor === api.today;
  const bucketOptions = inbox ? [inbox, ...buckets.filter((b) => b.id !== inbox.id)] : buckets;
  const taskTags = api.tagsByTask.get(task.id) ?? [];
  // Subtasks, one level (spec §11): a live parent makes this a subtask; only
  // top-level tasks offer the subtask list / add affordance.
  const parent = task.parentId ? (api.tasks.find((t) => t.id === task.parentId) ?? null) : null;
  const subtasks = api.subtasksByParent.get(task.id) ?? [];
  // Blocked-by dependencies (spec §5c): edges, computed blocked state.
  const blockers = api.blockersByTask.get(task.id) ?? [];
  const dependents = api.dependentsByTask.get(task.id) ?? [];
  const blocked = api.blockedTaskIds.has(task.id);
  const openBlockers = blockers.filter((b) => b.status !== "done" && b.status !== "archived");

  // ── linked-entity hub (DF-8: Tasks joins the spine) ──────────────────────────
  // The same reusable spine roll-up Notes/Contacts render, focused on this task.
  // Present only when the caller wired the spine (runtime + workspace).
  const hubFocus: EntityRef = { type: "task", id: task.id };
  const hub = useEntityHub(runtime, workspaceId, hubFocus);
  const hubReload = hub.reload;
  const showHub = !!runtime && !!workspaceId;
  // Quiet by default: render the "Linked" section ONLY when it has content (or a
  // genuine load error worth surfacing) — never an empty teaching card on every
  // unlinked task. A drop still lands anywhere on the panel (the page's
  // HubDropZone wraps the whole thing) and the refresh event pops the section in
  // once the first edge exists.
  const showHubSection = showHub && (hub.status === "error" || hub.sections.length > 0);
  // A drag-onto-hub link is persisted by the enclosing page's DndContext; re-pull
  // so the new edge shows without a re-select (NO-7b parity).
  useEffect(() => {
    if (!showHub) return;
    const onRefresh = () => hubReload();
    window.addEventListener(TASK_DETAIL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TASK_DETAIL_REFRESH_EVENT, onRefresh);
  }, [showHub, hubReload]);
  const openLinkedEntity =
    onOpenEntity ??
    ((ref: EntityRef) =>
      window.dispatchEvent(
        new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: ref.type, id: ref.id } }),
      ));
  const onChangeLinkKind =
    canEdit && runtime && workspaceId
      ? (link: EntityLink, kind: RelationKind) =>
          void runtime.spine
            .setLinkKind({ workspaceId, linkId: link.id, relationKind: kind })
            .then(hubReload)
      : undefined;
  const onUnlink =
    canEdit && runtime && workspaceId
      ? (link: EntityLink) =>
          void runtime.spine.deleteLink({ workspaceId, linkId: link.id }).then(hubReload)
      : undefined;

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) api.patchTask(task.id, { title: next });
    else if (!next) setTitle(task.title); // refuse empty — restore
  };
  const commitDescription = (html: string) => {
    if (html !== task.description) api.patchTask(task.id, { description: html });
  };
  const commitDuration = () => {
    const n = Number.parseInt(duration, 10);
    const next = Number.isFinite(n) && n > 0 ? n : null;
    if (next !== task.durationMinutes) api.patchTask(task.id, { durationMinutes: next });
  };
  const commitTimeSpent = () => {
    // Only write when the field actually changed — a bare focus/blur must never
    // truncate the seconds-precise total accrued in Focus to whole minutes. The
    // draft is re-seeded from the live display on focus, so this equality holds
    // for an untouched field even after the total changed in the background.
    if (timeSpent === timeSpentDisplay) return;
    const n = Number.parseInt(timeSpent, 10);
    api.setTimeSpent(task.id, Number.isFinite(n) && n > 0 ? n * 60 : 0);
  };

  // Recurrence (spec §5d): the current rule mapped back to a preset for the
  // picker; a parsed rule outside the vocabulary reads as "custom".
  const recurrencePreset: string = task.recurrence
    ? (RECURRENCE_PRESETS.find(
        (p) => recurrenceFromPreset(p.value, task.scheduledAt).rrule === task.recurrence?.rrule,
      )?.value ?? "custom")
    : "none";
  const setRecurrencePreset = (v: string) => {
    if (v === "custom" || v === recurrencePreset) return;
    if (v === "none") {
      // Clearing the rule keeps the task and its current occurrence (one-off).
      api.patchTask(task.id, { recurrence: null });
      return;
    }
    const rec = recurrenceFromPreset(v as RecurrencePreset, task.scheduledAt);
    // A task without a scheduled time adopts the rule's first occurrence —
    // the occurrence IS the scheduled time in the single-row model.
    api.patchTask(
      task.id,
      task.scheduledAt ? { recurrence: rec } : { recurrence: rec, scheduledAt: rec.nextOccurrence },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* px/py inset so a focused field's ring isn't clipped by this scroll box */}
      <div className="pane-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1">
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
          className={cn(detailTitleVariants(), "border-transparent bg-transparent px-0")}
        />

        {/* sub-task of — quiet breadcrumb back to the parent (one level) */}
        {parent ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CornerDownRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="shrink-0">Sub-task of</span>
            <button
              type="button"
              onClick={() => onSelectTask(parent.id)}
              className="min-w-0 truncate underline-offset-2 hover:text-foreground hover:underline"
            >
              {parent.title || "Untitled"}
            </button>
            {canEdit ? (
              <button
                type="button"
                onClick={() => api.setTaskParent(task.id, null)}
                className="ml-auto shrink-0 text-muted-foreground/70 hover:text-foreground"
              >
                Detach
              </button>
            ) : null}
          </div>
        ) : null}

        {/* description — label-less under the title (Linear-style). Lexical so
            `@mention` / `/ref` link entities inline (DF-23); stored as HTML. */}
        <EntityTextEditor
          value={task.description}
          editable={canEdit}
          runtime={runtime}
          workspaceId={workspaceId}
          source={{ type: "task", id: task.id }}
          sourceLabel={task.title}
          sourceIcon="task"
          ariaLabel="Description"
          placeholder={canEdit ? "Add a description…  @ or / to link" : undefined}
          onCommit={commitDescription}
        />

        <Separator />

        {/* properties — label-left / value-right grid (PropertyRow) */}
        <div className="space-y-0.5">
          <PropertyRow label="Status">
            <Select
              value={task.status}
              disabled={!canEdit}
              onValueChange={(v) => api.patchTask(task.id, { status: v as TaskStatus })}
            >
              <SelectTrigger size="sm" variant="ghost" className="w-full">
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
          </PropertyRow>

          <PropertyRow label="Bucket">
            <Select
              value={task.bucketId}
              disabled={!canEdit}
              onValueChange={(v) => {
                if (v !== task.bucketId) api.patchTask(task.id, { bucketId: v });
              }}
            >
              <SelectTrigger size="sm" variant="ghost" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bucketOptions.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      {b.isSystem ? (
                        <Inbox className="size-3.5 text-muted-foreground" aria-hidden />
                      ) : null}
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropertyRow>

          <PropertyRow label="Scheduled">
            <DateField
              value={task.scheduledAt ? new Date(task.scheduledAt) : null}
              onChange={(d) => api.patchTask(task.id, { scheduledAt: d ? d.toISOString() : null })}
              withTime
              variant="ghost"
              placeholder="Set time"
              aria-label="Scheduled time"
              disabled={!canEdit}
              className="w-full"
            />
          </PropertyRow>

          <PropertyRow label="Due">
            <DateField
              value={task.dueDate ? new Date(task.dueDate) : null}
              onChange={(d) => api.patchTask(task.id, { dueDate: d ? d.toISOString() : null })}
              variant="ghost"
              placeholder="Set date"
              aria-label="Due date"
              disabled={!canEdit}
              className="w-full"
            />
          </PropertyRow>

          <PropertyRow label="Assignee">
            <AssigneeSelect
              value={task.assigneeId}
              disabled={!canEdit}
              onChange={(id) => {
                if (id === task.assigneeId) return;
                if (id) {
                  void previewAssign(task.bucketId, id).then((msg) => {
                    if (msg) toast.message(msg);
                  });
                }
                api.patchTask(task.id, { assigneeId: id });
              }}
            />
          </PropertyRow>

          <PropertyRow label="Priority">
            <LevelSelect
              value={task.priority}
              disabled={!canEdit}
              onChange={(v) => api.patchTask(task.id, { priority: v })}
            />
          </PropertyRow>

          <PropertyRow label="Energy">
            <LevelSelect
              value={task.energyLevel}
              disabled={!canEdit}
              onChange={(v) => api.patchTask(task.id, { energyLevel: v })}
            />
          </PropertyRow>

          <PropertyRow label="Duration">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                size="sm"
                variant="ghost"
                disabled={!canEdit}
                value={duration}
                placeholder="—"
                onChange={(e) => setDuration(e.target.value)}
                onBlur={commitDuration}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">min est</span>
            </div>
          </PropertyRow>

          {/* manual time-spent — adjust the total; the live tracker is Focus-only */}
          <PropertyRow label="Time spent">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                size="sm"
                variant="ghost"
                disabled={!canEdit}
                value={timeSpentEditing ? timeSpent : timeSpentDisplay}
                placeholder="0"
                aria-label="Time spent in minutes"
                onFocus={() => {
                  setTimeSpentDraft(timeSpentDisplay);
                  setTimeSpentEditing(true);
                }}
                onChange={(e) => setTimeSpentDraft(e.target.value)}
                onBlur={() => {
                  setTimeSpentEditing(false);
                  commitTimeSpent();
                }}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </PropertyRow>

          {/* recurrence — the single-row engine (spec §5d): preset vocabulary
              only (no complex picker), plus the skip-occurrence affordance */}
          <PropertyRow label="Repeat">
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <Select
                  value={recurrencePreset}
                  disabled={!canEdit}
                  onValueChange={setRecurrencePreset}
                >
                  <SelectTrigger size="sm" variant="ghost" className="w-full">
                    <span className="flex min-w-0 items-center gap-2">
                      <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <SelectValue />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Doesn’t repeat</SelectItem>
                    {RECURRENCE_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                    {recurrencePreset === "custom" && task.recurrence ? (
                      <SelectItem value="custom">{recurrenceLabel(task.recurrence)}</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              {canEdit &&
              task.recurrence &&
              task.status !== "done" &&
              task.status !== "archived" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => api.skipOccurrence(task.id)}
                      aria-label="Skip this occurrence"
                    >
                      <SkipForward className="size-3.5" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Skip this occurrence</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </PropertyRow>
        </div>

        <Separator />

        {/* collections — full-width labeled sections (lists, not scalar values) */}
        <div className="space-y-4">
          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1.5">
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
                />
              ) : taskTags.length === 0 ? (
                <span className="text-xs text-muted-foreground">No tags</span>
              ) : null}
            </div>
          </Field>

          {/* subtasks — one level: only top-level tasks get the list/affordance */}
          {!parent ? (
            <SubtasksField
              task={task}
              subtasks={subtasks}
              canEdit={canEdit}
              onSelectTask={onSelectTask}
              api={api}
            />
          ) : null}

          {/* blocked-by dependencies — edges, never a stored status (spec §5c) */}
          <BlockedByField
            task={task}
            blockers={blockers}
            canEdit={canEdit}
            onSelectTask={onSelectTask}
            api={api}
          />
          {dependents.length > 0 ? (
            <Field label="Blocks">
              <div className="space-y-0.5">
                {dependents.map((d) => (
                  <RelatedTaskRow key={d.id} task={d} onSelect={() => onSelectTask(d.id)} />
                ))}
              </div>
            </Field>
          ) : null}

          {canEdit ? (
            <Button
              type="button"
              variant={committed ? "secondary" : "default"}
              size="sm"
              className="w-full justify-center"
              onClick={() => api.toggleCommit(task.id)}
            >
              <ListChecks aria-hidden />
              {committed ? "Remove from queue" : "Commit to Queue"}
            </Button>
          ) : null}
        </div>

        {/* linked-entity hub (DF-8) — the spine roll-up: notes / emails /
            contacts / events linked to this task, grouped with counts. Reuses
            the shared spine components exactly as Notes/Contacts do; the
            enclosing page makes it a drag-to-link drop target. Quiet: shown only
            when it has links (or a load error), never an empty card. */}
        {showHubSection ? (
          <>
            <Separator />
            <div className="space-y-1">
              <Eyebrow>Linked</Eyebrow>
              <EntityHub
                variant="rail"
                status={hub.status}
                sections={hub.sections}
                canEdit={canEdit}
                onOpen={openLinkedEntity}
                onChangeKind={onChangeLinkKind}
                onUnlink={onUnlink}
                onRetry={hubReload}
              />
            </div>
          </>
        ) : null}

        {/* ambient mirrors — quiet, factual, never alarming (principles 4 & 5) */}
        {drifted || blocked || task.rescheduleCount > 0 ? (
          <>
            <Separator />
            <div className="space-y-1.5 text-xs text-muted-foreground">
              {drifted ? (
                <Mirror icon={<Clock className="size-3.5" aria-hidden />}>
                  Drifted — its scheduled time has passed.
                </Mirror>
              ) : null}
              {blocked ? (
                <Mirror icon={<CircleDashed className="size-3.5" aria-hidden />}>
                  {openBlockers.length === 1
                    ? `Blocked — waiting on “${openBlockers[0].title || "Untitled"}”.`
                    : `Blocked — waiting on ${openBlockers.length} tasks.`}
                </Mirror>
              ) : null}
              {task.rescheduleCount > 0 ? (
                <Mirror icon={<RotateCcw className="size-3.5" aria-hidden />}>
                  Rescheduled {task.rescheduleCount}×
                </Mirror>
              ) : null}
            </div>
          </>
        ) : null}

        <Separator />

        {/* metadata */}
        <div className="space-y-1 text-2xs text-muted-foreground/80">
          <CreatedMeta task={task} />
          <Meta term="Updated" icon={<Hourglass className="size-3 opacity-70" aria-hidden />}>
            {formatTimestamp(task.updatedAt)}
          </Meta>
        </div>

        <Separator />

        {/* activity trail — attributed intent ops, an ambient mirror
            (docs/moduo-module-contract.md Pillar 3). Quiet, factual, newest
            first; never a wall. */}
        <ActivitySection task={task} api={api} />
      </div>
    </div>
  );
}

// ── activity trail (module contract Pillar 3) ──────────────────────────────────

function ActivitySection({ task, api }: { task: Task; api: TasksModuleApi }) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const { loadActivity, activityStamp } = api;

  useEffect(() => {
    let cancelled = false;
    void loadActivity(task.id)
      .then((rows) => {
        if (!cancelled) setEntries(rows.filter(isTrailEntry));
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, activityStamp, loadActivity]);

  return (
    <div className="space-y-1">
      <Eyebrow>Activity</Eyebrow>
      <div className="space-y-1 text-2xs leading-relaxed text-muted-foreground/80">
        {(entries ?? []).map((entry) => (
          // One flowing line (action + a quiet inline timestamp) — wraps as a
          // paragraph instead of a narrow 2-column action that breaks to 3 lines.
          <div key={entry.id}>
            {activityActorName(entry, api.currentUserId)} {activityLine(entry)}{" "}
            <span className="whitespace-nowrap text-muted-foreground/50 tabular-nums">
              · {formatTimestamp(entry.createdAt)}
            </span>
          </div>
        ))}
        {entries && entries.length === 0 ? (
          // creation needs no activity row (contract §3) — the metadata above
          // already anchors it
          <span>Nothing yet.</span>
        ) : null}
      </div>
    </div>
  );
}

// ── subtasks (one level — spec §11) ────────────────────────────────────────────

function SubtasksField({
  task,
  subtasks,
  canEdit,
  onSelectTask,
  api,
}: {
  task: Task;
  subtasks: Task[];
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const progress = api.subtaskProgressByTask.get(task.id);

  if (subtasks.length === 0 && !canEdit) return null;

  const submit = () => {
    const next = draft.trim();
    if (next) api.addSubtask(task.id, next);
    setDraft("");
  };

  return (
    <div className="space-y-1">
      <Eyebrow className="flex items-baseline gap-1.5">
        Subtasks
        {progress && progress.total > 0 ? (
          // quiet n/m mirror — factual, never alarming (principles 4 & 5)
          <span className="font-sans normal-case tracking-normal text-muted-foreground/70 tabular-nums">
            {progress.done}/{progress.total}
          </span>
        ) : null}
      </Eyebrow>
      {subtasks.length > 0 ? (
        <div className="space-y-0.5">
          {subtasks.map((subtask) => (
            <SubtaskRow
              key={subtask.id}
              subtask={subtask}
              canEdit={canEdit}
              onSelect={() => onSelectTask(subtask.id)}
              api={api}
            />
          ))}
        </div>
      ) : null}
      {canEdit ? (
        adding ? (
          <Input
            autoFocus
            value={draft}
            placeholder="Add a subtask…"
            aria-label="New subtask title"
            className="h-8 text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit(); // stays open for rapid entry
              } else if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              submit();
              setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden />
            Add subtask
          </button>
        )
      ) : null}
    </div>
  );
}

function SubtaskRow({
  subtask,
  canEdit,
  onSelect,
  api,
}: {
  subtask: Task;
  canEdit: boolean;
  onSelect: () => void;
  api: TasksModuleApi;
}) {
  const done = subtask.status === "done";
  const committed = !!subtask.committedFor && subtask.committedFor === api.today;
  return (
    <div className="group flex min-h-7 items-center gap-2 rounded px-1 hover:bg-accent/60">
      <CompleteToggle done={done} disabled={!canEdit} onToggle={() => api.toggleDone(subtask)} />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {subtask.title || "Untitled"}
      </button>
      {/* individually committable — start a scary task via its smallest step */}
      {canEdit || committed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!canEdit}
              aria-label={committed ? "Remove from queue" : "Add to queue"}
              onClick={() => api.toggleCommit(subtask.id)}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded transition-opacity",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100",
                committed
                  ? "text-primary"
                  : "text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100",
              )}
            >
              <ListChecks className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{committed ? "Queued — click to remove" : "Add to queue"}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ── blocked-by dependencies (spec §5c) ─────────────────────────────────────────

function BlockedByField({
  task,
  blockers,
  canEdit,
  onSelectTask,
  api,
}: {
  task: Task;
  blockers: Task[];
  canEdit: boolean;
  onSelectTask: (id: string) => void;
  api: TasksModuleApi;
}) {
  if (blockers.length === 0 && !canEdit) return null;
  return (
    <Field label="Blocked by">
      {blockers.length > 0 ? (
        <div className="space-y-0.5">
          {blockers.map((blocker) => (
            <RelatedTaskRow
              key={blocker.id}
              task={blocker}
              onSelect={() => onSelectTask(blocker.id)}
              onRemove={canEdit ? () => api.removeBlocker(task.id, blocker.id) : undefined}
            />
          ))}
        </div>
      ) : null}
      {canEdit ? <BlockerPicker task={task} api={api} /> : null}
    </Field>
  );
}

/** A quiet related-task row: click-through title, optional ✕ (removes the
 * edge, never the task). Done blockers render struck through — inert. */
function RelatedTaskRow({
  task,
  onSelect,
  onRemove,
}: {
  task: Task;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const done = task.status === "done" || task.status === "archived";
  return (
    <div className="group flex min-h-7 items-center gap-2 rounded px-1 hover:bg-accent/60">
      <CircleDashed className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "min-w-0 flex-1 truncate text-left text-sm",
          done ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {task.title || "Untitled"}
      </button>
      {onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Remove dependency"
              onClick={onRemove}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>Remove dependency (keeps the task)</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Searchable picker for a new blocker: open, live tasks only; tasks that
 * would close a cycle are filtered out (the hook + DB trigger backstop). */
function BlockerPicker({ task, api }: { task: Task; api: TasksModuleApi }) {
  const [open, setOpen] = useState(false);
  const currentBlockerIds = new Set((api.blockersByTask.get(task.id) ?? []).map((b) => b.id));
  const candidates = api.tasks.filter(
    (t) =>
      t.id !== task.id &&
      t.status !== "done" &&
      t.status !== "archived" &&
      !currentBlockerIds.has(t.id) &&
      !wouldCreateCycle(t.id, task.id, api.taskRelations),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" aria-hidden />
          Add blocker
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Blocked by…" />
          <CommandList>
            <CommandEmpty>No matching open tasks.</CommandEmpty>
            <CommandGroup>
              {candidates.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.title || "Untitled"} ${t.id}`}
                  onSelect={() => {
                    api.addBlocker(task.id, t.id);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{t.title || "Untitled"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

function LevelSelect({
  value,
  disabled,
  onChange,
}: {
  value: EnergyLevel | PriorityLevel | null;
  disabled: boolean;
  onChange: (next: EnergyLevel | PriorityLevel | null) => void;
}) {
  return (
    <Select
      value={value ?? "none"}
      disabled={disabled}
      onValueChange={(v) => onChange(v === "none" ? null : (v as EnergyLevel | PriorityLevel))}
    >
      <SelectTrigger size="sm" variant="ghost" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">None</SelectItem>
        {LEVEL_OPTIONS.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssigneeSelect({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (next: string | null) => void;
}) {
  const { assignees, byId } = useAssignees();
  // An assignee who left the workspace stays assigned and reads "Former
  // member", so the control never renders blank.
  const known = byId(value);
  return (
    <Select
      value={toAssigneeValue(value)}
      disabled={disabled}
      onValueChange={(v) => onChange(fromAssigneeValue(v))}
    >
      <SelectTrigger size="sm" variant="ghost" className="w-full" aria-label="Assignee">
        <SelectValue placeholder="Unassigned">
          {known ? (
            <span className="flex items-center gap-2">
              <AssigneeAvatar assignee={known} className="size-4" />
              <span className="truncate">{known.name}</span>
            </span>
          ) : (
            assigneeLabel(value, byId)
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {assigneeOptions(assignees).map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            <span className="flex items-center gap-2">
              {o.assignee ? (
                <AssigneeAvatar assignee={o.assignee} className="size-4" />
              ) : (
                <User className="size-4 text-muted-foreground" aria-hidden />
              )}
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Created by Ada · Oct 6, 2026, 7:20 PM"; without "by" when the creator isn't known. */
function CreatedMeta({ task }: { task: Task }) {
  const { byId } = useAssignees();
  const by = createdByLabel(task, byId);
  return (
    <Meta term="Created" icon={<CalendarClock className="size-3 opacity-70" aria-hidden />}>
      {by ? `by ${by} · ${formatTimestamp(task.createdAt)}` : formatTimestamp(task.createdAt)}
    </Meta>
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
