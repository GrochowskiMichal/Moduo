// DF-20 — Global capture command bar routing.
//
// The pure + runtime halves of capture-anywhere (critique CC-11): parse one line
// into a target module + body, then write it through that module's create op. A
// plain line is a Task in the Inbox — reusing the quick-capture write path
// (`seedInbox` + `upsertTask`, same as the Home quick-capture widget) — while the
// `/note` `/event` `/contact` prefixes route to the sibling modules. Kept out of
// the UI so both halves are unit-testable with a mock runtime.

import type { ModuoRuntime } from "../../lib/runtime.types";
import { endPosition, makeTask } from "../tasks/helpers";
import { parseCapture } from "../tasks/parse/capture-parser";

export type CaptureTarget = "task" | "note" | "event" | "contact";

export type CaptureRoute = {
  target: CaptureTarget;
  /** The slash prefix that selects this route ("" for the default Task). */
  prefix: string;
  label: string;
  /** Module page the created entity lives on (the toast's "Open" jump). */
  openTo: string;
  /**
   * The lane whose *edit* permission gates the write ("tasks" also covers the
   * calendar, which rides the Tasks lane at alpha per specs/calendar.md).
   * `null` = ungated client-side (Contacts has no lane at alpha — the server op
   * is the guard).
   */
  lane: "tasks" | "notes" | null;
};

/**
 * Ordered routes. Task is the default (no prefix); the three sibling prefixes
 * route elsewhere. Order drives the hint legend + chip row in the capture bar.
 */
export const CAPTURE_ROUTES: readonly CaptureRoute[] = [
  { target: "task", prefix: "", label: "Task", openTo: "/tasks", lane: "tasks" },
  { target: "note", prefix: "/note", label: "Note", openTo: "/notes", lane: "notes" },
  { target: "event", prefix: "/event", label: "Event", openTo: "/calendar", lane: "tasks" },
  { target: "contact", prefix: "/contact", label: "Contact", openTo: "/contacts", lane: null },
];

const TASK_ROUTE = CAPTURE_ROUTES[0];

/** Prefix → route, incl. an explicit `/task` alias for the default. Longest
 *  prefixes first so a future `/note…` can't be shadowed by a shorter match. */
const PREFIX_ALIASES: ReadonlyArray<{ prefix: string; route: CaptureRoute }> = [
  ...CAPTURE_ROUTES.filter((r) => r.prefix).map((route) => ({ prefix: route.prefix, route })),
  { prefix: "/task", route: TASK_ROUTE },
].sort((a, b) => b.prefix.length - a.prefix.length);

/** The two lane permissions the capture bar can read from the workspace
 *  (Contacts + Calendar have no client lane at alpha — see CaptureRoute.lane). */
export type CaptureModulePermissions = { notes: string; tasks: string };

/**
 * Whether the current member may create through a route. Tasks/Events ride the
 * Tasks lane, Notes its own; both need edit-or-admin (mirrors the dashboard
 * widget-body write gate). Contacts is ungated client-side (lane null) — the
 * server op is the guard, matching the palette's ungated "New contact" action.
 */
export function canWriteRoute(route: CaptureRoute, perms: CaptureModulePermissions): boolean {
  if (route.lane === null) return true;
  const perm = route.lane === "notes" ? perms.notes : perms.tasks;
  return perm === "edit" || perm === "admin";
}

/**
 * Whether a thrown write error is a permission denial. Contacts is ungated
 * client-side (no client lane at alpha), so a view-only member's capture reaches
 * the server and its op RAISEs "You don't have edit access to Contacts …"; the
 * notes/calendar ops word it the same ("… edit access to …"). Tasks write the
 * table directly (quick-capture parity), so a drifted client gate would surface
 * a raw Postgres RLS violation instead. Matching both lets the capture bar show
 * its consistent "view-only access" copy rather than a raw server string.
 */
export function isPermissionError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("edit access") || m.includes("row-level security") || m.includes("permission denied")
  );
}

export type ParsedCaptureCommand = { route: CaptureRoute; body: string };

/**
 * Split a capture line into its target route + body. A leading `/note`
 * `/event` `/contact` `/task` prefix (case-insensitive, terminated by
 * whitespace or end-of-input) selects that route; anything else — including a
 * `/` that isn't a known prefix ("/groceries") — is a Task carrying the whole
 * line. Never throws; an empty input is an empty-body Task.
 */
export function parseCaptureCommand(input: string): ParsedCaptureCommand {
  const text = input.replace(/^\s+/, "");
  const lower = text.toLowerCase();
  for (const { prefix, route } of PREFIX_ALIASES) {
    if (lower === prefix || lower.startsWith(`${prefix} `) || lower.startsWith(`${prefix}\t`)) {
      return { route, body: text.slice(prefix.length).trimStart() };
    }
  }
  return { route: TASK_ROUTE, body: text };
}

export type CaptureCreated = {
  target: CaptureTarget;
  /** Success-toast title (the created entity's label). */
  title: string;
  /** Success-toast secondary line (where it landed / when it's scheduled). */
  description: string;
  /** Module page to jump to on "Open". */
  openTo: string;
};

/** timed 60-min block / all-day day / next-hour default for a captured event. */
function eventTimes(
  parsed: ReturnType<typeof parseCapture>,
  now: Date,
): { startsAt: string; endsAt: string; allDay: boolean } {
  if (parsed.scheduledAt) {
    const start = new Date(parsed.scheduledAt);
    const end = new Date(start.getTime() + 60 * 60_000);
    return { startsAt: start.toISOString(), endsAt: end.toISOString(), allDay: false };
  }
  if (parsed.dueDate) {
    // All-day convention mirrors event-quick-create: local-midnight → next
    // local-midnight so the chip lands on the right day regardless of TZ.
    const d = new Date(parsed.dueDate);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return { startsAt: start.toISOString(), endsAt: end.toISOString(), allDay: true };
  }
  // No date/time parsed → a 1-hour block at the next full hour (an editable,
  // concrete slot beats a presumptuous all-day placeholder).
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60_000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString(), allDay: false };
}

const EVENT_WHEN_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const EVENT_DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function eventDescription(startsAt: string, allDay: boolean): string {
  const d = new Date(startsAt);
  return allDay ? `All day · ${EVENT_DAY_FMT.format(d)}` : EVENT_WHEN_FMT.format(d);
}

/**
 * Perform the capture write for a resolved target. Reuses each module's own
 * create op (no bespoke write path): Tasks' seed-Inbox + upsert (the exact
 * quick-capture flow), Notes' `create`, Calendar's `createEvent`, Contacts'
 * `createContact`. Tasks/Events also reuse the Tier-1 `parseCapture` so
 * "buy milk tomorrow 5pm" strips the date into a scheduled time. Throws on a
 * runtime/permission failure — the caller toasts it.
 */
export async function createCapturedEntity(input: {
  runtime: ModuoRuntime;
  workspaceId: string;
  target: CaptureTarget;
  body: string;
  now?: Date;
}): Promise<CaptureCreated> {
  const { runtime, workspaceId, target } = input;
  const now = input.now ?? new Date();
  const trimmed = input.body.trim();

  switch (target) {
    case "note": {
      const note = await runtime.notesV2.create({ workspaceId, title: trimmed });
      return {
        target,
        title: note.title || trimmed || "Untitled",
        description: "Added to Notes",
        openTo: "/notes",
      };
    }
    case "contact": {
      const contact = await runtime.contacts.createContact({ workspaceId, name: trimmed });
      return {
        target,
        title: contact.name || trimmed,
        description: "Added to Contacts",
        openTo: "/contacts",
      };
    }
    case "event": {
      const parsed = parseCapture(trimmed, now);
      const title = parsed.title.trim() || trimmed;
      const { startsAt, endsAt, allDay } = eventTimes(parsed, now);
      await runtime.calendar.createEvent({ workspaceId, title, startsAt, endsAt, allDay });
      return {
        target,
        title,
        description: eventDescription(startsAt, allDay),
        openTo: "/calendar",
      };
    }
    case "task":
    default: {
      const parsed = parseCapture(trimmed, now);
      const title = parsed.title.trim() || trimmed;
      const inbox = await runtime.tasks.seedInbox(workspaceId);
      // Append to the end of the Inbox — a fresh read for the position is cheap
      // (capture is infrequent) and keeps ordering sane (quick-capture parity).
      const bundle = await runtime.tasks.list(workspaceId);
      const inboxTasks = bundle.tasks.filter((t) => t.bucketId === inbox.id && !t.deletedAt);
      const task = makeTask({
        workspaceId,
        bucketId: inbox.id,
        title,
        position: endPosition(inboxTasks),
        // parseCapture already sets scheduledAt to a recurrence's first
        // occurrence (single-row model, CaptureModal parity).
        scheduledAt: parsed.scheduledAt,
        dueDate: parsed.dueDate,
        recurrence: parsed.recurrence,
      });
      await runtime.tasks.upsertTask(task);
      return {
        target: "task",
        title,
        description: parsed.summary ? `${parsed.summary} · Inbox` : "Added to Inbox",
        openTo: "/tasks",
      };
    }
  }
}
