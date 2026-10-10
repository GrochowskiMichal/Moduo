// Which properties the detail panel shows (tasks-v2 §9, comp §5 option C):
// Status, Assignee, Priority, Due and Tags always; Energy, Scheduled, Time and
// Repeat once set. Until then those four sit in one quiet line that names them
// ("+ Energy · Scheduled · Time · Repeat"); picking one shows its row, empty,
// with its editor open. Pure.

import { estimateOf, type Task } from "./model";

export type OptionalProperty = "energy" | "scheduled" | "time" | "repeat";

/** Panel order of the optional rows (they interleave with the core rows). */
export const OPTIONAL_PROPERTIES: OptionalProperty[] = ["energy", "scheduled", "time", "repeat"];

export const OPTIONAL_PROPERTY_LABELS: Record<OptionalProperty, string> = {
  energy: "Energy",
  scheduled: "Scheduled",
  time: "Time",
  repeat: "Repeat",
};

type PropertyFields = Pick<
  Task,
  | "energyLevel"
  | "scheduledAt"
  | "durationMinutes"
  | "estimateMinutes"
  | "timeSpentSeconds"
  | "recurrence"
>;

/** Whether the task has a value for this property. Time = an estimate or tracked time. */
export function isPropertySet(task: PropertyFields, property: OptionalProperty): boolean {
  switch (property) {
    case "energy":
      return task.energyLevel != null;
    case "scheduled":
      return task.scheduledAt != null;
    case "time":
      return estimateOf(task) != null || task.timeSpentSeconds > 0;
    case "repeat":
      return task.recurrence != null;
  }
}

/** The optional rows to show: set ones, plus the ones picked from the quiet line. */
export function shownOptionalProperties(
  task: PropertyFields,
  revealed: ReadonlySet<OptionalProperty>,
): Set<OptionalProperty> {
  return new Set(OPTIONAL_PROPERTIES.filter((p) => revealed.has(p) || isPropertySet(task, p)));
}

/** What the quiet line still offers, in panel order; empty when every row shows. */
export function quietLineProperties(
  task: PropertyFields,
  revealed: ReadonlySet<OptionalProperty>,
): OptionalProperty[] {
  const shown = shownOptionalProperties(task, revealed);
  return OPTIONAL_PROPERTIES.filter((p) => !shown.has(p));
}
