// The right panel's Project view (Tasks v3 default p, call 72a): the project
// is the context when nothing is selected inside it, and while a task fills
// the centre (call 32). TV-U16 makes it the project's overview (spec §3,
// REPLAN 16), ordered for someone opening a prepared project cold: what it is
// (state, dates, lead, client, description), how far it is ("Done this month
// · 14 · 22h"), what's next, its sections, who's on it, what waits, its files,
// what happened recently, and the ways out (time report, copy, duplicate,
// archive). Everything comes from the reader's own copy, so it shows only what
// they can see.

import type { ProjectState } from "@contracts/vocabularies";
import { isClosedTask, taskCategoryOf } from "@contracts/vocabularies";
import { Archive, Clock, Copy, CopyPlus, FolderKanban, Paperclip, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { Chip } from "../../../components/ui/chip";
import { CollectionHeader } from "../../../components/ui/collection-header";
import { EmptyState } from "../../../components/ui/empty-state";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Progress } from "../../../components/ui/progress";
import { PropertyRow } from "../../../components/ui/property-row";
import { formatDate, formatDay, formatDurationSeconds } from "../../../lib/time-format";
import { useTimeRegion } from "../../../lib/time-region";
import { cn } from "../../../lib/utils";
import { useAssignees } from "../assignees";
import { projectOverviewText } from "../list-export";
import type { Bucket, Section, Task, TaskCompletion, TaskWaitingEntry } from "../model";
import {
  doneInRange,
  nextUp,
  projectFacts,
  projectPeople,
  recentActivity,
  sectionProgress,
  tasksOfProject,
  waitingIn,
} from "../project-overview";
import { bucketDotColor } from "../sidebar";
import { reportRange } from "../time-report";
import { nowOn, useToday } from "../use-today";
import { AssigneeAvatar } from "./assignee-avatar";
import {
  ProjectClientValue,
  ProjectDateValue,
  ProjectDescription,
  ProjectLeadValue,
  ProjectStateValue,
} from "./project-overview-parts";
import { TaskStatusIcon } from "./status-icon";
import { TimeReportSheet } from "./time-report-sheet";
import { useProjectEditable, useProjectFiles, useProjectTime } from "./use-project-overview-data";

export { projectFacts } from "../project-overview";

/** The fields the overview edits (each one through `projects_op_update`). */
export type ProjectOverviewPatch = {
  startsOn?: string | null;
  targetOn?: string | null;
  leadId?: string | null;
  clientContactId?: string | null;
  description?: string | null;
};

/**
 * Chat's two places on the overview (the Chat re-plan, CH11 / CH13 / CH52):
 * the "Conversation: Acme · 3 new" line when a channel is linked to the
 * project, and the project's decisions ("Decided in Acme · Oct 12: …"), shown
 * only to people who can read that conversation. Chat's blocks pass them;
 * until then nothing renders there.
 */
export type ProjectChatSlots = {
  conversation?: ReactNode;
  decisions?: ReactNode;
};

const NO_COMPLETIONS: readonly TaskCompletion[] = [];
const NO_WAITING: readonly TaskWaitingEntry[] = [];

/** The quiet optional fields, revealed from the "+" line (hidden until set). */
type Optional = "start" | "lead" | "client";
const OPTIONAL_LABEL: Record<Optional, string> = { start: "Start", lead: "Lead", client: "Client" };

export function ProjectPanel({
  project,
  tasks,
  sections,
  completions = NO_COMPLETIONS,
  waiting = NO_WAITING,
  canEdit = false,
  onSetState,
  onEdit,
  onOpenTask,
  onArchive,
  onDuplicate,
  chat,
}: {
  project: Bucket | null;
  /** The reader's tasks (an archived project's when it's archived). */
  tasks: readonly Task[];
  sections: readonly Section[];
  completions?: readonly TaskCompletion[];
  waiting?: readonly TaskWaitingEntry[];
  /** Whether the reader may change the project (and it isn't archived). */
  canEdit?: boolean;
  /** Active, On hold or Done; the page asks first when Done meets open work. */
  onSetState?: (project: Bucket, state: ProjectState) => void;
  onEdit?: (projectId: string, patch: ProjectOverviewPatch) => void;
  onOpenTask?: (taskId: string) => void;
  onArchive?: (project: Bucket) => void;
  onDuplicate?: (project: Bucket) => void;
  /** Chat's slots (empty until Chat fills them). */
  chat?: ProjectChatSlots;
}) {
  if (!project || project.isSystem) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No project here"
        description="Open a project, or pick a task in one."
      />
    );
  }
  return (
    <ProjectOverview
      // A new project starts with its own revealed fields and sheet.
      key={project.id}
      project={project}
      tasks={tasks}
      sections={sections}
      completions={completions}
      waiting={waiting}
      canEdit={canEdit && !project.archivedAt}
      onSetState={onSetState}
      onEdit={onEdit}
      onOpenTask={onOpenTask}
      onArchive={onArchive}
      onDuplicate={onDuplicate}
      chat={chat}
    />
  );
}

function ProjectOverview({
  project,
  tasks,
  sections,
  completions,
  waiting,
  canEdit,
  onSetState,
  onEdit,
  onOpenTask,
  onArchive,
  onDuplicate,
  chat,
}: {
  project: Bucket;
  tasks: readonly Task[];
  sections: readonly Section[];
  completions: readonly TaskCompletion[];
  waiting: readonly TaskWaitingEntry[];
  canEdit: boolean;
  onSetState?: (project: Bucket, state: ProjectState) => void;
  onEdit?: (projectId: string, patch: ProjectOverviewPatch) => void;
  onOpenTask?: (taskId: string) => void;
  onArchive?: (project: Bucket) => void;
  onDuplicate?: (project: Bucket) => void;
  chat?: ProjectChatSlots;
}) {
  const { byId } = useAssignees();
  const region = useTimeRegion();
  const [reportOpen, setReportOpen] = useState(false);
  const [revealed, setRevealed] = useState<Optional | null>(null);
  // Tasks edit in the workspace isn't enough: a project can be shared view-only.
  const access = useProjectEditable(project.id, canEdit);
  const allowed = canEdit && access === true;
  const editable = allowed && !!onEdit;
  const edit = (patch: ProjectOverviewPatch) => onEdit?.(project.id, patch);

  const mine = useMemo(() => tasksOfProject(tasks, project.id), [tasks, project.id]);
  const facts = useMemo(() => projectFacts(tasks, project.id), [tasks, project.id]);
  const next = useMemo(() => nextUp(tasks, project.id, sections), [tasks, project.id, sections]);
  const parts = useMemo(
    () => sectionProgress(tasks, project.id, sections),
    [tasks, project.id, sections],
  );
  const people = useMemo(
    () => projectPeople(tasks, project.id, project.leadId),
    [tasks, project.id, project.leadId],
  );
  const waits = useMemo(
    () => waitingIn(tasks, waiting, new Set([project.id])),
    [tasks, waiting, project.id],
  );
  const activity = useMemo(
    () => recentActivity(tasks, completions, project.id),
    [tasks, completions, project.id],
  );
  // "Done this month · 14 · 22h" (AC6.6): the same month and zone as the
  // time report, so the two always agree: the month of your saved time zone
  // (MOD-110), which turns over at that zone's midnight even while the
  // overview stays open.
  const today = useToday(region.timeZone);
  const month = useMemo(
    () => reportRange("this_month", nowOn(today), region.weekStartsOn, null, region.timeZone),
    [region.weekStartsOn, region.timeZone, today],
  );
  const doneThisMonth = useMemo(
    () => doneInRange(tasks, completions, project.id, month, region.timeZone),
    [tasks, completions, project.id, month, region.timeZone],
  );
  // Tracked totals move when anyone's time saves: the cue to read the hours again.
  const trackedStamp = mine.reduce((sum, t) => sum + (t.timeSpentSeconds || 0), 0);
  const monthSeconds = useProjectTime({
    workspaceId: project.workspaceId,
    projectId: project.id,
    from: month.from,
    to: month.to,
    zone: region.timeZone,
    stamp: trackedStamp,
  });
  const taskIds = useMemo(() => mine.map((t) => t.id), [mine]);
  const files = useProjectFiles(project.workspaceId, taskIds);
  const taskById = useMemo(() => new Map(mine.map((t) => [t.id, t])), [mine]);

  const nameOf = (id: string | null | undefined) => {
    const person = id ? byId(id) : null;
    return person ? person.fullName || person.name : id ? "Former member" : "Someone";
  };
  const doneLine = `Done this month · ${doneThisMonth}${
    monthSeconds && monthSeconds > 0 ? ` · ${formatDurationSeconds(monthSeconds)}` : ""
  }`;

  const state: ProjectState = project.status ?? "active";
  const shows = (o: Optional) =>
    revealed === o ||
    (o === "start" && !!project.startsOn) ||
    (o === "lead" && !!project.leadId) ||
    (o === "client" && !!project.clientContactId);
  const quiet = editable
    ? (["start", "lead", "client"] as Optional[]).filter((o) => !shows(o))
    : [];

  const copyText = () => {
    const open = mine.filter((t) => !isClosedTask(t));
    const text = projectOverviewText(
      project,
      facts,
      open,
      {
        projectName: () => project.name,
        assigneeName: (id) => {
          const person = id ? byId(id) : null;
          return person ? person.fullName || person.name : null;
        },
      },
      { description: project.description ?? "", doneThisMonth: doneLine },
    );
    if (!navigator.clipboard) {
      toast.error("Couldn’t copy.");
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => toast("Copied"),
      () => toast.error("Couldn’t copy."),
    );
  };

  return (
    <div className="pane-scroll flex h-full min-h-0 flex-col gap-5 overflow-y-auto px-1 pt-2.5 pb-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <NavRowDot color={bucketDotColor(project)} />
          <h3 className="min-w-0 flex-1 break-words font-display text-lg font-semibold text-foreground">
            {project.name}
          </h3>
          {project.archivedAt ? <Chip>Archived</Chip> : null}
        </div>

        <div className="flex flex-col gap-px">
          <PropertyRow label="Status">
            <ProjectStateValue
              state={state}
              canEdit={allowed && !!onSetState}
              onChange={(s) => onSetState?.(project, s)}
            />
          </PropertyRow>
          {shows("start") ? (
            <PropertyRow label="Start">
              <ProjectDateValue
                day={project.startsOn}
                label="Start date"
                placeholder="Set a start"
                canEdit={editable}
                defaultOpen={revealed === "start"}
                onChange={(day) => edit({ startsOn: day })}
              />
            </PropertyRow>
          ) : null}
          {project.targetOn || editable ? (
            <PropertyRow label="Target">
              <ProjectDateValue
                day={project.targetOn}
                label="Target date"
                placeholder="Set a target"
                canEdit={editable}
                onChange={(day) => edit({ targetOn: day })}
              />
            </PropertyRow>
          ) : null}
          {shows("lead") ? (
            <PropertyRow label="Lead">
              <ProjectLeadValue
                leadId={project.leadId ?? null}
                canEdit={editable}
                defaultOpen={revealed === "lead"}
                onChange={(id) => edit({ leadId: id })}
              />
            </PropertyRow>
          ) : null}
          {shows("client") ? (
            <PropertyRow label="Client">
              <ProjectClientValue
                workspaceId={project.workspaceId}
                clientId={project.clientContactId ?? null}
                canEdit={editable}
                defaultOpen={revealed === "client"}
                onChange={(id) => edit({ clientContactId: id })}
              />
            </PropertyRow>
          ) : null}
          {quiet.length > 0 ? (
            <div className="flex min-h-(--ctrl-h-sm) items-center gap-2 font-sans text-sm text-muted-foreground">
              <Plus className="size-icon-sm shrink-0" aria-hidden />
              <span className="flex min-w-0 flex-wrap items-center">
                {quiet.map((o, i) => (
                  <span key={o} className="flex items-center">
                    {i > 0 ? (
                      <span aria-hidden className="px-1">
                        ·
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setRevealed(o)}
                      aria-label={`Add ${OPTIONAL_LABEL[o].toLowerCase()}`}
                      className="rounded-sm whitespace-nowrap transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {OPTIONAL_LABEL[o]}
                    </button>
                  </span>
                ))}
              </span>
            </div>
          ) : null}
        </div>

        <ProjectDescription
          text={project.description ?? ""}
          canEdit={editable}
          onSave={(text) => edit({ description: text })}
        />
        {/* Chat's slots: the linked conversation, then the project's decisions. */}
        {chat?.conversation ?? null}
        {chat?.decisions ?? null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Progress value={facts.done} max={facts.total} label="Done" />
        <p className="font-sans text-sm text-muted-foreground tabular-nums">
          {facts.done} of {facts.total} done · {facts.open} open
          {facts.inProgress > 0 ? ` · ${facts.inProgress} in progress` : ""}
          {facts.backlog > 0 ? ` · Backlog ${facts.backlog}` : ""}
        </p>
        <p className="font-sans text-sm text-muted-foreground tabular-nums">{doneLine}</p>
      </div>

      <section className="flex flex-col">
        <CollectionHeader
          as="h4"
          label="Next up"
          count={next.tasks.length + next.rest || undefined}
        />
        {next.tasks.length === 0 ? (
          <p className="px-1 font-sans text-sm text-muted-foreground">Nothing open right now.</p>
        ) : (
          <ul className="flex flex-col">
            {next.tasks.map((t) => (
              <li key={t.id}>
                <OverviewTaskButton task={t} onOpen={onOpenTask}>
                  {t.dueOn || t.dueDate ? (
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {formatDay(t.dueOn ? `${t.dueOn}T12:00:00` : (t.dueDate as string))}
                    </span>
                  ) : null}
                  {t.assigneeId ? (
                    <AssigneeAvatar
                      assignee={byId(t.assigneeId)}
                      assigneeId={t.assigneeId}
                      size="icon"
                      className="shrink-0"
                    />
                  ) : null}
                </OverviewTaskButton>
              </li>
            ))}
            {next.rest > 0 ? (
              <li className="px-1 pt-0.5 font-sans text-sm text-muted-foreground tabular-nums">
                and {next.rest} more open
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {parts.length > 0 ? (
        <section className="flex flex-col">
          <CollectionHeader as="h4" label="Sections" count={parts.length} />
          <ul className="flex flex-col">
            {parts.map(({ section, done, total }) => (
              <li
                key={section.id}
                className="flex min-h-(--ctrl-h-sm) items-center gap-2 px-1 font-sans text-base"
              >
                <span className="min-w-0 flex-1 break-words">{section.name}</span>
                {section.endsOn ? (
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(`${section.endsOn}T12:00:00`)}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {done} of {total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {people.length > 0 ? (
        <section className="flex flex-col">
          <CollectionHeader as="h4" label="People" count={people.length} />
          <ul className="flex flex-col">
            {people.map((p) => (
              <li
                key={p.userId}
                className="flex min-h-(--ctrl-h-sm) items-center gap-2 px-1 font-sans text-base"
              >
                <AssigneeAvatar assignee={byId(p.userId)} assigneeId={p.userId} size="icon" />
                <span className="min-w-0 flex-1 break-words">{nameOf(p.userId)}</span>
                {p.lead ? (
                  <span className="shrink-0 text-xs text-muted-foreground">Lead</span>
                ) : null}
                {p.open > 0 ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {p.open} open
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {waits.length > 0 ? (
        <section className="flex flex-col">
          <CollectionHeader as="h4" label="Waiting" count={waits.length} />
          <ul className="flex flex-col">
            {waits.map((w) => (
              <li key={w.task.id}>
                <OverviewTaskButton task={w.task} onOpen={onOpenTask}>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {waitingWho(w.entries[0], nameOf)}
                    {w.entries.length > 1 ? ` +${w.entries.length - 1}` : ""} · {formatDay(w.since)}
                  </span>
                </OverviewTaskButton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {files.files.length > 0 ? (
        <section className="flex flex-col">
          <CollectionHeader
            as="h4"
            label="Files"
            count={files.partial ? `${files.files.length}+` : files.files.length}
          />
          <ul className="flex flex-col">
            {files.files.slice(0, 5).map((f) => {
              const task = taskById.get(f.entityId);
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTask?.(f.entityId)}
                    disabled={!onOpenTask}
                    className={cn(ROW_BUTTON, "py-0.5")}
                  >
                    <Paperclip
                      className="size-icon-sm shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    {/* The name on one line and its task under it, both cut
                        short: beside each other, a long name got a column
                        one letter wide (MOD-127). */}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{f.fileName}</span>
                      {task ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {task.title || "Untitled"}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
            {files.files.length > 5 ? (
              <li className="px-1 pt-0.5 font-sans text-sm text-muted-foreground tabular-nums">
                and {files.files.length - 5} more on its tasks
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {activity.length > 0 ? (
        <section className="flex flex-col">
          {/* "Recently", not "Lately" (MOD-139). */}
          <CollectionHeader as="h4" label="Recently" />
          <ul className="flex flex-col">
            {activity.map((a) => (
              <li key={`${a.kind}:${a.task.id}:${a.at}`}>
                <button
                  type="button"
                  onClick={() => onOpenTask?.(a.task.id)}
                  disabled={!onOpenTask}
                  className={ROW_BUTTON}
                >
                  <span className="min-w-0 flex-1 break-words">
                    <span className="text-muted-foreground">
                      {nameOf(a.userId)} {a.kind === "done" ? "finished" : "added"}{" "}
                    </span>
                    {a.task.title || "Untitled"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDay(a.at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
          <Clock aria-hidden />
          Time report
        </Button>
        <Button size="sm" variant="ghost" onClick={copyText}>
          <Copy aria-hidden />
          Copy as text
        </Button>
        {onDuplicate && access === true ? (
          <Button size="sm" variant="ghost" onClick={() => onDuplicate(project)}>
            <CopyPlus aria-hidden />
            Duplicate…
          </Button>
        ) : null}
        {allowed && onArchive ? (
          <Button size="sm" variant="ghost" onClick={() => onArchive(project)}>
            <Archive aria-hidden />
            Archive…
          </Button>
        ) : null}
      </div>
      <TimeReportSheet
        open={reportOpen}
        onOpenChange={setReportOpen}
        workspaceId={project.workspaceId}
        scope={{ kind: "project", projectId: project.id, name: project.name }}
      />
    </div>
  );
}

const ROW_BUTTON = cn(
  "flex min-h-(--ctrl-h-sm) w-full items-center gap-2 rounded-md px-1 text-left font-sans text-base text-foreground",
  "transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  "disabled:cursor-default disabled:hover:bg-transparent",
);

/** One task in an overview list: its status, its title, then its facts. */
function OverviewTaskButton({
  task,
  onOpen,
  children,
}: {
  task: Task;
  onOpen?: (id: string) => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(task.id)}
      disabled={!onOpen}
      className={ROW_BUTTON}
    >
      <TaskStatusIcon category={taskCategoryOf(task)} className="shrink-0" />
      <span className="min-w-0 flex-1 break-words">{task.title || "Untitled"}</span>
      {children}
    </button>
  );
}

/** Who or what a task waits on, in a few words ("on Anna", "on an email"). */
function waitingWho(
  entry: TaskWaitingEntry | undefined,
  nameOf: (id: string | null | undefined) => string,
): string {
  if (!entry) return "";
  switch (entry.kind) {
    case "person":
      return `on ${nameOf(entry.ref)}`;
    case "email":
      return entry.label ? `on “${entry.label}”` : "on an email";
    case "agent":
      return entry.label ? `on ${entry.label}` : "on an agent";
    default:
      return entry.label ? `on ${entry.label}` : "on something";
  }
}
