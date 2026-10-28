// "Move to another calendar" (CALR-4b): a one-off Moduo event goes to a
// Google calendar you can write. One event, never two: Google gets it first
// (the create's own path, then the mirror stores Google's answer), and only
// then does the Moduo row go. One Undo takes the Google copy back and, only
// once Google has let it go, brings the Moduo row back. A refusal at any step
// leaves one copy, or says plainly where a stray one is.

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { recordUndo } from "../commands/undo";
import { moveTargets } from "../event-menu";
import type { CalendarAccountModel, CalendarEventModel, CalendarMirrorEventInput } from "../events";
import { pushGoogleWebEvent } from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { mapGoogleEvent } from "../mirror";

type Calendar = Pick<CalendarModuleApi, "events" | "accounts" | "reload" | "deleteEvent">;

const reason = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** A tick for the page to draw what a reload brought (the latest-ref updates in an effect). */
const drawn = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Whether the event has links (null: couldn't tell). */
async function hasLinks(
  runtime: ModuoRuntime,
  workspaceId: string,
  eventId: string,
): Promise<boolean | null> {
  if (!runtime.spine) return false;
  try {
    const links = await runtime.spine.listLinks({
      workspaceId,
      entityType: "event",
      entityId: eventId,
    });
    return links.length > 0;
  } catch {
    return null;
  }
}

/** The event made on the Google calendar, as the mirror stores Google's answer. */
async function createOnGoogle(
  source: CalendarEventModel,
  target: CalendarAccountModel,
): Promise<CalendarMirrorEventInput> {
  const raw = await pushGoogleWebEvent({
    externalAccountId: target.externalId,
    title: source.title,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    allDay: source.allDay,
    description: source.description || undefined,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  const answer = mapGoogleEvent(raw);
  if (!answer) throw new Error("Google did not return the event.");
  return answer;
}

export function useEventMove(
  calendar: Calendar,
  runtime: ModuoRuntime | null,
  workspaceId: string,
  userId: string | null,
): (eventId: string, targetId: string) => Promise<void> {
  // The undo and the rollbacks run later: read the events as they are then.
  const latest = useRef(calendar);
  useEffect(() => {
    latest.current = calendar;
  });
  // One move per event at a time: a second pick while Google answers would push a second copy.
  const moving = useRef(new Set<string>());

  /**
   * Takes the Google copy back: through the module when the week has its row
   * (it also drops the chip), else straight through the runtime. True once it's gone.
   */
  const takeBack = useCallback(
    async (
      source: CalendarEventModel,
      target: CalendarAccountModel,
      mapped: CalendarMirrorEventInput,
    ): Promise<boolean> => {
      const row = latest.current.events.find(
        (e) => e.sourceAccountId === target.id && e.externalEventId === mapped.externalEventId,
      );
      if (row) return (await latest.current.deleteEvent(row.id, { quiet: true })) !== false;
      if (!runtime) return false;
      try {
        await runtime.calendar.removeGoogleEvent({
          workspaceId,
          account: target,
          event: {
            ...source,
            id: "",
            sourceAccountId: target.id,
            externalEventId: mapped.externalEventId,
            calendarId: mapped.calendarId || target.externalId,
          },
        });
        return true;
      } catch {
        return false;
      }
    },
    [runtime, workspaceId],
  );

  return useCallback(
    async (eventId: string, targetId: string) => {
      const source = calendar.events.find((e) => e.id === eventId);
      if (!source || !runtime || !workspaceId || moving.current.has(eventId)) return;
      // Only where the menu offers it (re-checked: the event may have changed).
      const allowed = moveTargets(source, calendar.accounts, userId).some((t) => t.id === targetId);
      const target = calendar.accounts.find((a) => a.id === targetId);
      if (!allowed || !target) return;
      const where = target.displayLabel || "Google";
      moving.current.add(eventId);
      try {
        // Linked notes, tasks and people hang off this row; a new Google row would lose them.
        const linked = await hasLinks(runtime, workspaceId, eventId);
        if (linked !== false) {
          toast.error(
            linked
              ? `It has links, so it stays on Your calendar. Unlink them to move it to ${where}.`
              : "Couldn't check the event's links, so it stays put. Try again.",
          );
          return;
        }

        // 1. On Google first. A refusal here changes nothing.
        let mapped: CalendarMirrorEventInput;
        try {
          mapped = await createOnGoogle(source, target);
        } catch (err) {
          toast.error(`Couldn't move it to ${where}: ${reason(err, "Google refused.")}`);
          return;
        }

        // 2. The mirror keeps Google's answer; if it can't, Google's copy goes again.
        try {
          await runtime.calendar.mirrorEvents({
            workspaceId,
            accountId: target.id,
            events: [mapped],
            deletedExternalIds: [],
          });
        } catch (err) {
          const gone = await takeBack(source, target, mapped);
          toast.error(
            gone
              ? reason(err, "Couldn't move the event.")
              : `Couldn't finish the move: a copy is on ${where} in Google. Delete it there.`,
          );
          return;
        }

        // 3. Only now does the Moduo row go; if it won't, the Google copy does.
        try {
          await runtime.calendar.removeEvent({ workspaceId, eventId: source.id });
        } catch (err) {
          await latest.current.reload();
          await drawn();
          const gone = await takeBack(source, target, mapped);
          toast.error(
            gone
              ? reason(err, "Couldn't move the event.")
              : `Couldn't finish the move: it's on Your calendar and on ${where}. Delete one.`,
          );
          return;
        }
        await calendar.reload();

        recordUndo(
          `Moved to ${where}`,
          async () => {
            // The Moduo row comes back only once Google has let its copy go.
            if (!(await takeBack(source, target, mapped))) return;
            await runtime.calendar.restoreEvent({ workspaceId, eventId: source.id });
            await latest.current.reload();
          },
          { toast: true, description: source.title },
        );
      } finally {
        moving.current.delete(eventId);
      }
    },
    [calendar, runtime, workspaceId, userId, takeBack],
  );
}
