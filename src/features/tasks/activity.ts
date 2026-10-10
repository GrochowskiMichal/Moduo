// The task activity trail's rendering vocabulary: one quiet, factual sentence
// per intent op (docs/moduo-module-contract.md, Pillar 3). Mirrors, never
// walls — no alarm, no judgment, newest first in the detail panel.

import { formatDate } from "../../lib/time-format";
import { formatScheduled, PRIORITY_LABELS, STATUS_LABELS } from "./helpers";
import type { ActivityEntry, PriorityLevel, TaskStatus } from "./model";

/** Who did it — "You", the recorded display name, or a quiet fallback. */
export function activityActorName(
  entry: Pick<ActivityEntry, "actorType" | "actorId" | "actorLabel">,
  currentUserId: string | null,
): string {
  if (entry.actorId && currentUserId && entry.actorId === currentUserId) return "You";
  if (entry.actorLabel) return entry.actorLabel;
  if (entry.actorType === "agent") return "An agent";
  if (entry.actorType === "api_key") return "An API client";
  return "Someone";
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** "Jun 12" from a queue date (YYYY-MM-DD), in the one grammar. */
function formatQueueDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return formatDate(d);
}

/** How a field reads in a trail line ("edited the title and the due date"). */
const FIELD_NAMES: Record<string, string> = {
  title: "the title",
  description: "the description",
  bucket_id: "the project",
  parent_id: "the parent task",
  due_date: "the due date",
  scheduled_at: "the scheduled time",
  duration_minutes: "the estimate",
  recurrence: "the repeat",
  energy_level: "the energy",
  priority: "the priority",
};

/** `{from, to}` of one field in a tasks.update payload. */
function change(p: Record<string, unknown>, field: string): { from: unknown; to: unknown } {
  const v = p[field];
  if (v && typeof v === "object") {
    const c = v as Record<string, unknown>;
    return { from: c.from ?? null, to: c.to ?? null };
  }
  return { from: null, to: null };
}

/** One field edit (TV-D8's tasks_op_update), in plain words. */
function updateLine(p: Record<string, unknown>): string {
  const fields = Array.isArray(p.fields)
    ? p.fields.filter((f): f is string => typeof f === "string")
    : [];
  if (fields.length === 1) {
    const field = fields[0]!;
    const { to } = change(p, field);
    switch (field) {
      case "title":
        return str(to) ? `renamed this to “${str(to)}”` : "cleared the title";
      case "description":
        return "edited the description";
      case "due_date": {
        const day = str(to) ? formatDate(new Date(str(to)!)) : null;
        return day ? `set the due date to ${day}` : "cleared the due date";
      }
      case "scheduled_at": {
        const at = formatScheduled(str(to));
        return at ? `scheduled this for ${at}` : "cleared the scheduled time";
      }
      case "bucket_id": {
        const n = typeof p.subtasks_moved === "number" ? p.subtasks_moved : 0;
        if (n === 1) return "moved this and its subtask to another project";
        return n > 1
          ? `moved this and its ${n} subtasks to another project`
          : "moved this to another project";
      }
      case "parent_id":
        return to ? "made this a subtask" : "made this a top-level task";
      case "priority": {
        const label = PRIORITY_LABELS[str(to) as PriorityLevel];
        return label ? `set ${label.toLowerCase()}` : "cleared the priority";
      }
      case "recurrence":
        return to ? "changed how this repeats" : "stopped this repeating";
    }
  }
  const names = fields.map((f) => FIELD_NAMES[f] ?? f);
  if (names.length === 0) return "edited this";
  if (names.length === 1) return `changed ${names[0]}`;
  return `changed ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Ops that are notifications rather than trail entries. `tasks.completed`
 * (TV-D1) tells a task's creator that a teammate finished it; the trail
 * already says so through `tasks.set_status`.
 */
const NOTIFICATION_ONLY_OPS = new Set(["tasks.completed"]);

export function isTrailEntry(entry: Pick<ActivityEntry, "op">): boolean {
  return !NOTIFICATION_ONLY_OPS.has(entry.op);
}

/**
 * The action sentence (lowercase start — rendered after the actor name).
 * Unknown ops fall back to the raw op name so the trail never lies by
 * omission when a newer client adds ops.
 */
export function activityLine(entry: Pick<ActivityEntry, "op" | "payload">): string {
  const p = entry.payload ?? {};
  switch (entry.op) {
    // TV-D8: every create and edit is an op.
    case "tasks.create":
      return "created this";
    case "tasks.update":
      return updateLine(p);
    case "tasks.delete":
      return "deleted this";
    case "tasks.restore":
      return "restored this";
    case "tasks.commit": {
      const day = formatQueueDate(p.for);
      if (p.reordered) return "sent this to the end of the queue";
      return day ? `committed this for ${day}` : "committed this";
    }
    case "tasks.uncommit":
      return "removed this from the queue";
    case "tasks.skip_today":
      return "skipped this for the day";
    // TV-D2: personal queues; the queue is always the actor's own, so the
    // line reads right after "You" and after a name alike.
    case "tasks.queue_add":
      return p.at === "top" ? "queued this first" : "queued this";
    case "tasks.queue_remove":
      return "removed this from the queue";
    case "tasks.set_status": {
      const from = str(p.from) as TaskStatus | null;
      const to = str(p.to) as TaskStatus | null;
      // TV-D9: lines name the project's own status and carry its category;
      // older lines have only the legacy values.
      const toCategory = str(p.to_category) ?? (to === "archived" ? "wont_do" : to);
      const fromCategory = str(p.from_category) ?? (from === "archived" ? "wont_do" : from);
      const toName = str(p.to_name);
      if (toCategory === "done") return "completed this";
      // "archived" reads "Won't do" everywhere (calls 21, 23).
      if (toCategory === "wont_do") return "marked this Won’t do";
      if (p.reason === "scheduled") return `scheduled this, so it moved to ${toName ?? "To do"}`;
      if ((fromCategory === "done" || fromCategory === "wont_do") && toCategory === "todo")
        return "reopened this";
      if (toCategory === "in_progress" && (!toName || toName === "In progress"))
        return "started this";
      if (toName) return `set this to ${toName}`;
      return to ? `set this to ${STATUS_LABELS[to] ?? to}` : "changed the status";
    }
    case "tasks.reschedule": {
      const to = formatScheduled(str(p.to));
      return to ? `rescheduled this to ${to}` : "rescheduled this";
    }
    case "tasks.unschedule":
      return "cleared the scheduled time";
    case "tasks.skip_occurrence": {
      const to = formatScheduled(str(p.to));
      return to ? `skipped an occurrence — next ${to}` : "skipped an occurrence";
    }
    case "tasks.catch_up": {
      const to = formatScheduled(str(p.to));
      const kind = str(p.kind);
      if (kind === "reopen")
        return to ? `reopened this for ${to} (recurrence)` : "reopened this (recurrence)";
      if (kind === "adopt")
        return to
          ? `scheduled its occurrence, ${to} (recurrence)`
          : "adopted its occurrence (recurrence)";
      return to ? `caught this up to ${to} (recurrence)` : "caught this up (recurrence)";
    }
    // ── DF-9 spine-generated task notifications, seen in the trail too ─────────
    // Logged by the tasks_notify_spine trigger (module='tasks'), so they surface
    // in this entity trail — render a neutral, third-person sentence here (the
    // notification-card voice "…to you" would be wrong in a trail anyone reads).
    case "tasks.assigned":
      // TV-D1 rows say where it went: unassigned, taken by the actor, or handed on.
      if ("to" in p && p.to === null) return "unassigned this";
      if (p.self === true) return "took this";
      return "assigned this";
    case "tasks.completed":
      return "completed this";
    case "tasks.unblocked": {
      const blocker = str(p.blocker_title);
      return blocker ? `finished “${blocker}”, unblocking this` : "unblocked this";
    }
    default:
      return entry.op;
  }
}
