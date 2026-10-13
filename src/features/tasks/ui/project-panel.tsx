// The right panel's Project view (Tasks v3 default p, call 72a): the
// project is the context when nothing is selected inside it, and while a
// task fills the centre (call 32). Name and colour, status, start → target,
// lead and client, progress, what's open, and its sections. The full
// overview (time, files, waiting, activity, "Done this month") is TV-U16's.

import { isClosedTask, taskCategoryOf } from "@contracts/vocabularies";
import { FolderKanban } from "lucide-react";

import { CollectionHeader } from "../../../components/ui/collection-header";
import { EmptyState } from "../../../components/ui/empty-state";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Progress } from "../../../components/ui/progress";
import { PropertyRow } from "../../../components/ui/property-row";
import { formatDate } from "../../../lib/time-format";
import { useAssignees } from "../assignees";
import type { Bucket, Section, Task } from "../model";
import { bucketDotColor } from "../sidebar";

const STATE_LABEL: Record<string, string> = {
  active: "Active",
  on_hold: "On hold",
  done: "Done",
};

/** A project's numbers, from its live tasks (subtasks count as tasks). Pure. */
export function projectFacts(tasks: readonly Task[], projectId: string) {
  const mine = tasks.filter((t) => t.bucketId === projectId && !t.deletedAt);
  const counted = mine.filter((t) => taskCategoryOf(t) !== "backlog");
  const done = counted.filter((t) => taskCategoryOf(t) === "done").length;
  const closed = counted.filter((t) => isClosedTask(t)).length;
  return {
    total: counted.length - (closed - done),
    done,
    open: counted.filter((t) => !isClosedTask(t)).length,
    inProgress: counted.filter((t) => taskCategoryOf(t) === "in_progress").length,
    backlog: mine.length - counted.length,
  };
}

export function ProjectPanel({
  project,
  tasks,
  sections,
}: {
  project: Bucket | null;
  tasks: readonly Task[];
  sections: readonly Section[];
}) {
  const { byId } = useAssignees();
  if (!project || project.isSystem) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="No project here"
        description="Open a project, or pick a task in one."
      />
    );
  }
  const facts = projectFacts(tasks, project.id);
  const lead = project.leadId ? byId(project.leadId) : null;
  const projectSections = sections
    .filter((s) => s.projectId === project.id)
    .sort((a, b) => a.position - b.position);
  const dates =
    project.startsOn || project.targetOn
      ? [
          project.startsOn ? formatDate(`${project.startsOn}T12:00:00`) : null,
          project.targetOn ? formatDate(`${project.targetOn}T12:00:00`) : null,
        ]
          .map((d) => d ?? "…")
          .join(" → ")
      : null;
  return (
    <div className="pane-scroll flex h-full min-h-0 flex-col gap-5 overflow-y-auto px-1 pt-2.5 pb-4">
      <div className="flex items-center gap-2">
        <NavRowDot color={bucketDotColor(project)} />
        <h3 className="min-w-0 break-words font-display text-lg font-semibold text-foreground">
          {project.name}
        </h3>
      </div>
      <div className="flex flex-col gap-px">
        <PropertyRow label="Status">
          <span className="px-1.5 font-sans text-base text-foreground">
            {STATE_LABEL[project.status ?? "active"] ?? "Active"}
          </span>
        </PropertyRow>
        {dates ? (
          <PropertyRow label="Dates">
            <span className="px-1.5 font-sans text-base text-foreground tabular-nums">{dates}</span>
          </PropertyRow>
        ) : null}
        {lead ? (
          <PropertyRow label="Lead">
            <span className="px-1.5 font-sans text-base text-foreground">
              {lead.fullName || lead.name}
            </span>
          </PropertyRow>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Progress value={facts.done} max={facts.total} label="Done" />
        <p className="font-sans text-sm text-muted-foreground tabular-nums">
          {facts.done} of {facts.total} done · {facts.open} open
          {facts.inProgress > 0 ? ` · ${facts.inProgress} in progress` : ""}
          {facts.backlog > 0 ? ` · Backlog ${facts.backlog}` : ""}
        </p>
      </div>
      {projectSections.length > 0 ? (
        <div>
          <CollectionHeader label="Sections" count={projectSections.length} />
          <ul className="flex flex-col">
            {projectSections.map((s) => {
              const open = tasks.filter(
                (t) => t.sectionId === s.id && !t.deletedAt && !isClosedTask(t),
              ).length;
              return (
                <li
                  key={s.id}
                  className="flex min-h-(--ctrl-h-sm) items-center gap-2 px-1 font-sans text-base"
                >
                  <span className="min-w-0 flex-1 break-words">{s.name}</span>
                  {s.endsOn ? (
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      ends {formatDate(`${s.endsOn}T12:00:00`)}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {open}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
