// Which properties the detail panel shows (Tasks v3 §9): Status, Assignee +
// Team, Priority, Due and Tags always; Energy, Scheduled, Reminder,
// Estimate, Repeat and Waiting on once set. Until then those sit in one
// quiet line that names them ("+ Energy · Scheduled · Reminder · Estimate ·
// Repeat · Waiting on"); picking one shows its row, empty, with its editor
// open (Waiting on is a list, so it shows its collection). Also the copied
// branch name (AC3.7). Pure.

import { estimateOf, type Task } from "./model";

export type OptionalProperty =
  | "energy"
  | "scheduled"
  | "reminder"
  | "estimate"
  | "repeat"
  | "waiting";

/** Panel order of the optional rows. */
export const OPTIONAL_PROPERTIES: OptionalProperty[] = [
  "energy",
  "scheduled",
  "reminder",
  "estimate",
  "repeat",
  "waiting",
];

export const OPTIONAL_PROPERTY_LABELS: Record<OptionalProperty, string> = {
  energy: "Energy",
  scheduled: "Scheduled",
  reminder: "Reminder",
  estimate: "Estimate",
  repeat: "Repeat",
  waiting: "Waiting on",
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

/** What the task has beyond its own row: sessions, my reminders, Waiting on. */
export type PropertyExtras = { sessions: number; reminders: number; waiting: number };

const NONE: PropertyExtras = { sessions: 0, reminders: 0, waiting: 0 };

/** Whether the task has a value for this property. Estimate = an estimate or tracked time. */
export function isPropertySet(
  task: PropertyFields,
  property: OptionalProperty,
  extras: PropertyExtras = NONE,
): boolean {
  switch (property) {
    case "energy":
      return task.energyLevel != null;
    case "scheduled":
      return extras.sessions > 0 || task.scheduledAt != null;
    case "reminder":
      return extras.reminders > 0;
    case "estimate":
      return estimateOf(task) != null || task.timeSpentSeconds > 0;
    case "repeat":
      return task.recurrence != null;
    case "waiting":
      return extras.waiting > 0;
  }
}

/** The optional rows to show: set ones, plus the ones picked from the quiet line. */
export function shownOptionalProperties(
  task: PropertyFields,
  revealed: ReadonlySet<OptionalProperty>,
  extras: PropertyExtras = NONE,
): Set<OptionalProperty> {
  return new Set(
    OPTIONAL_PROPERTIES.filter((p) => revealed.has(p) || isPropertySet(task, p, extras)),
  );
}

/** What the quiet line still offers, in panel order; empty when every row shows. */
export function quietLineProperties(
  task: PropertyFields,
  revealed: ReadonlySet<OptionalProperty>,
  extras: PropertyExtras = NONE,
): OptionalProperty[] {
  const shown = shownOptionalProperties(task, revealed, extras);
  return OPTIONAL_PROPERTIES.filter((p) => !shown.has(p));
}

/**
 * The git branch name a task copies to (AC3.7): its handle and title in
 * lower case, words joined by "-", at most 60 characters, cut at a word:
 * "mod-142-logo-concepts". Without a handle, the title alone ("task" when
 * it has no letters either).
 */
export function branchName(handle: string | null, title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const head = handle ? handle.toLowerCase() : "";
  const full = [head, slug].filter(Boolean).join("-") || "task";
  if (full.length <= 60) return full;
  const cut = full.slice(0, 60);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > head.length ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}
