// What the route hands the side panel (specs/mail-v3.md §10): a contact's open
// tasks, notes and meetings from their spine links, and a linked task's facts
// from the Tasks data. Pure, so the route hook stays a thin adapter.

import { dayTime, shortDay } from "../reader/reader-format";
import type { SpineLinkRow } from "../ui/mail-page-wiring";
import type { MailContactDetail } from "./contact-view";
import type { MailTaskDetail } from "./task-view";

type PanelTask = {
  id: string;
  title: string;
  status: string;
  statusId?: string | null;
  dueOn?: string | null;
  dueDate: string | null;
  bucketId: string;
  description: string;
};

const OPEN = (status: string) => status !== "done" && status !== "archived";

/** A task's due day as local noon ms (dueOn is the date itself since TV-D9). */
function dueMs(t: Pick<PanelTask, "dueOn" | "dueDate">): number | null {
  if (t.dueOn) {
    const ms = new Date(`${t.dueOn}T12:00:00`).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = t.dueDate ? Date.parse(t.dueDate) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** The other ends of a contact's links, by type. */
function othersOf(contactId: string, links: readonly SpineLinkRow[]) {
  return links.map((l) =>
    l.sourceType === "contact" && l.sourceId === contactId
      ? { type: l.targetType, id: l.targetId }
      : { type: l.sourceType, id: l.sourceId },
  );
}

/** The Contact view's lists: open tasks, notes and upcoming meetings linked to the contact. */
export function contactDetailFrom(input: {
  contactId: string;
  links: readonly SpineLinkRow[];
  tasks: readonly PanelTask[];
  /** Registry labels by `type:id` (note titles). */
  labels: ReadonlyMap<string, string>;
  events: readonly { id: string; title: string; startsAt: string }[];
  nowMs: number;
}): MailContactDetail {
  const others = othersOf(input.contactId, input.links);
  const ids = (types: string[]) =>
    new Set(others.filter((o) => types.includes(o.type)).map((o) => o.id));
  const taskIds = ids(["task"]);
  const eventIds = ids(["calendar_event", "event"]);
  return {
    tasks: input.tasks
      .filter((t) => taskIds.has(t.id) && OPEN(t.status))
      .map((t) => {
        const due = dueMs(t);
        return { id: t.id, title: t.title, due: due === null ? null : shortDay(due, input.nowMs) };
      }),
    notes: [...ids(["note"])].map((id) => ({
      id,
      title: input.labels.get(`note:${id}`) ?? "Note",
    })),
    meetings: input.events
      .filter((e) => eventIds.has(e.id) && Date.parse(e.startsAt) > input.nowMs)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .map((e) => ({
        id: e.id,
        title: e.title || "(no title)",
        when: dayTime(Date.parse(e.startsAt), input.nowMs),
      })),
  };
}

const STATUS_WORD: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  archived: "Archived",
};

/** The Task view's facts for one task. */
export function taskDetailFrom(
  task: PanelTask,
  input: {
    projects: readonly { id: string; name: string; isSystem?: boolean }[];
    statuses: readonly { id: string; name: string }[];
    nowMs: number;
  },
): MailTaskDetail {
  const status =
    input.statuses.find((s) => s.id === task.statusId)?.name ??
    STATUS_WORD[task.status] ??
    task.status;
  const due = dueMs(task);
  return {
    id: task.id,
    title: task.title,
    status,
    due: due === null ? null : shortDay(due, input.nowMs),
    project: input.projects.find((p) => p.id === task.bucketId)?.name ?? null,
    notes: task.description.trim(),
  };
}

/** Today's open tasks by their due date (dueOn since TV-D9; dueDate is an instant). */
export function isDueOn(task: Pick<PanelTask, "dueOn" | "dueDate" | "status">, date: string) {
  if (!OPEN(task.status)) return false;
  if (task.dueOn) return task.dueOn === date;
  const due = dueMs(task);
  if (due === null) return false;
  const d = new Date(due);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return local === date;
}
