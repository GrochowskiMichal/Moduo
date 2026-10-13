// DF-20 — capture write paths, used by the capture shell's one-line types
// (components/app/capture-line.tsx, SH-1) and Chat's "make a task" action.
//
// Writes one captured line through its module's create op. A Task lands in
// the Inbox, reusing the quick-capture write path (`seedInbox` + `upsertTask`,
// same as the Home quick-capture widget); notes, events and contacts go through
// their own ops. The type is picked by the capture shell (⌘ + a module's
// number, tasks-v3 call 90b), never by a "/note" prefix any more. Kept out of
// the UI so it stays unit-testable with a mock runtime.

import type { ModuoRuntime } from "../../lib/runtime.types";
import { captureTaskToStore } from "../../lib/sync/capture";
import { findWorkspaceStore } from "../../lib/sync/store";
import { endPosition, makeTask } from "../tasks/helpers";
import { parseCapture } from "../tasks/parse/capture-parser";

export type CaptureTarget = "task" | "note" | "event" | "contact";

export type CaptureRoute = {
  target: CaptureTarget;
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

/** One route per capture target, Task first. */
export const CAPTURE_ROUTES: readonly CaptureRoute[] = [
  { target: "task", label: "Task", openTo: "/tasks", lane: "tasks" },
  { target: "note", label: "Note", openTo: "/notes", lane: "notes" },
  { target: "event", label: "Event", openTo: "/calendar", lane: "tasks" },
  { target: "contact", label: "Contact", openTo: "/contacts", lane: null },
];

/** The two lane permissions the capture shell reads from the workspace
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
      // parseCapture already sets scheduledAt to a recurrence's first
      // occurrence (single-row model, CaptureModal parity).
      const dates = {
        scheduledAt: parsed.scheduledAt,
        dueDate: parsed.dueDate,
        recurrence: parsed.recurrence,
      };
      const where = parsed.summary ? `${parsed.summary} · Inbox` : "Added to Inbox";
      // Through the workspace's shared store (TV-D11a): it shows at once on
      // every surface, lands at the end of the Inbox it already holds, and
      // offline it waits on this device under its own id (default g).
      const store = findWorkspaceStore(runtime, workspaceId);
      if (store) {
        const { queued } = await captureTaskToStore(store, { title, ...dates });
        return {
          target: "task",
          title,
          description: queued ? "Waiting to sync · Inbox" : where,
          openTo: "/tasks",
        };
      }
      // No store (no Tasks access to read, or a runtime outside the app
      // shell): straight to the server.
      const inbox = await runtime.tasks.seedInbox(workspaceId);
      await runtime.tasks.upsertTask(
        makeTask({ workspaceId, bucketId: inbox.id, title, position: endPosition([]), ...dates }),
      );
      return { target: "task", title, description: where, openTo: "/tasks" };
    }
  }
}
