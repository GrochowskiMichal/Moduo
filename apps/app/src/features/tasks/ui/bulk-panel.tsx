// The right panel on a selection (tasks-v3 §4, call 82: "4 tasks" in the
// panel's title row since MOD-109, the values they share and "Mixed" where
// they differ, as in Figma; TV-U12). Each value
// opens the same picker as the bottom bar's row, so a change here is one
// write with one Undo too. Prototype round-2b, frame 1 (Bulk).

import { taskCategoryOf } from "@contracts/vocabularies";
import type { ReactNode } from "react";

import { PropertyRow, PropertyValue } from "../../../components/ui/property-row";
import { useAssignees } from "../assignees";
import { dayWordOf, dueDayOf, type Shared, sharedValue, singleProject } from "../bulk";
import { LEVEL_OPTIONS } from "../helpers";
import type { ProjectStatus, Section, Tag, Task, Team } from "../model";
import { statusNameOf } from "../statuses";
import { StatusIcon } from "./status-icon";
import type { BulkPickerKind } from "./use-bulk-actions";

/** How many of the selected tasks the panel lists before "and n more". */
const LISTED = 8;

export function BulkPanel({
  tasks,
  statusById,
  bucketNameById,
  sections,
  teams,
  tagsByTask,
  canEdit,
  onPick,
}: {
  tasks: readonly Task[];
  statusById: ReadonlyMap<string, ProjectStatus>;
  bucketNameById: (id: string) => string;
  sections: readonly Section[];
  teams: readonly Team[];
  tagsByTask: ReadonlyMap<string, readonly Tag[]>;
  canEdit: boolean;
  onPick: (kind: BulkPickerKind) => void;
}) {
  const { byId } = useAssignees();
  const now = new Date();
  const project = singleProject(tasks);
  const status = sharedValue(tasks, (t) => statusNameOf(t, statusById));
  const category = sharedValue(tasks, (t) => taskCategoryOf(t));
  const assignee = sharedValue(tasks, (t) => t.assigneeId || null);
  const priority = sharedValue(tasks, (t) => t.priority ?? null);
  const due = sharedValue(tasks, (t) => dueDayOf(t));
  const where = sharedValue(tasks, (t) => t.bucketId);
  const section = sharedValue(tasks, (t) => t.sectionId ?? null);
  const team = sharedValue(tasks, (t) => t.teamId ?? null);
  const tags = sharedValue(
    tasks,
    (t) => (tagsByTask.get(t.id) ?? []).map((x) => x.name).sort(),
    (names) => names.join("\u0000"),
  );

  /** A property's value: what they share, "Mixed", or "None"; a click opens its picker. */
  function value<T>(
    kind: BulkPickerKind,
    shared: Shared<T>,
    label: (value: T) => string | null,
    opts: { icon?: ReactNode; disabled?: boolean } = {},
  ) {
    const text = shared.mixed ? "Mixed" : label(shared.value);
    return (
      <PropertyValue
        empty={shared.mixed || text === null}
        icon={shared.mixed ? undefined : opts.icon}
        disabled={!canEdit || opts.disabled}
        onClick={() => onPick(kind)}
      >
        {text ?? "None"}
      </PropertyValue>
    );
  }

  return (
    // "4 tasks" is the panel's title row (MOD-109, round-2b frame 1): the body
    // starts with the tasks.
    <div className="flex flex-col gap-4 p-4" data-testid="bulk-panel">
      <ul className="flex flex-col gap-1" aria-label="Selected tasks">
        {tasks.slice(0, LISTED).map((t) => (
          <li key={t.id} className="flex items-start gap-2 font-sans text-sm text-foreground">
            <StatusIcon category={taskCategoryOf(t)} className="mt-0.5 text-muted-foreground" />
            <span className="min-w-0 break-words">{t.title || "Untitled"}</span>
          </li>
        ))}
        {tasks.length > LISTED ? (
          <li className="font-sans text-sm text-muted-foreground">
            and {tasks.length - LISTED} more
          </li>
        ) : null}
      </ul>
      <div className="flex flex-col">
        <PropertyRow label="Status">
          {value("status", status, (name) => name, {
            icon: category.mixed ? undefined : <StatusIcon category={category.value} />,
          })}
        </PropertyRow>
        <PropertyRow label="Assignee">
          {value("assign", assignee, (id) => {
            if (!id) return null;
            const person = byId(id);
            // "You" as the value (MOD-137).
            return person ? person.name : "A former member";
          })}
        </PropertyRow>
        <PropertyRow label="Priority">
          {value("priority", priority, (level) =>
            level ? (LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level) : null,
          )}
        </PropertyRow>
        <PropertyRow label="Due">
          {value("date", due, (day) => (day ? dayWordOf(day, now) : null))}
        </PropertyRow>
        <PropertyRow label="Project">
          {value("move", where, (id) => bucketNameById(id))}
        </PropertyRow>
        <PropertyRow label="Section">
          {value(
            "section",
            section,
            (id) => (id ? (sections.find((x) => x.id === id)?.name ?? null) : null),
            // Sections belong to one project: across projects there's no list.
            { disabled: !project || !sections.some((x) => x.projectId === project) },
          )}
        </PropertyRow>
        <PropertyRow label="Tags" align="start">
          {value("tag", tags, (names) => (names.length > 0 ? names.join(", ") : null))}
        </PropertyRow>
        <PropertyRow label="Team">
          {value(
            "team",
            team,
            (id) => (id ? (teams.find((x) => x.id === id)?.name ?? null) : null),
            { disabled: teams.length === 0 },
          )}
        </PropertyRow>
      </div>
      <p className="font-sans text-xs text-muted-foreground">
        {canEdit
          ? `A change here applies to all ${tasks.length}. One Undo covers it.`
          : "You can view these tasks, not change them."}
      </p>
    </div>
  );
}
