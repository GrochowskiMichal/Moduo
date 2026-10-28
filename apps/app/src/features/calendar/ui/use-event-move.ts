// "Move to another calendar" (CALR-4b): a one-off Moduo event goes to a
// Google calendar you can write. One event, never two: Google gets it first
// (the create's own path, then the mirror stores Google's answer), and only
// then does the Moduo row go. One Undo takes the Google copy back and brings
// the Moduo row back. A refusal at any step leaves exactly one copy.

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { recordUndo } from "../commands/undo";
import { moveTargets } from "../event-menu";
import { pushGoogleWebEvent, removeGoogleWebEvent } from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { mapGoogleEvent } from "../mirror";

type Calendar = Pick<CalendarModuleApi, "events" | "accounts" | "reload" | "deleteEvent">;

const reason = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

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

  return useCallback(
    async (eventId: string, targetId: string) => {
      const source = calendar.events.find((e) => e.id === eventId);
      if (!source || !runtime || !workspaceId) return;
      // Only where the menu offers it (re-checked: the event may have changed).
      const allowed = moveTargets(source, calendar.accounts, userId).some((t) => t.id === targetId);
      const target = calendar.accounts.find((a) => a.id === targetId);
      if (!allowed || !target) return;

      // 1. On Google first. A refusal here changes nothing.
      let mapped: NonNullable<ReturnType<typeof mapGoogleEvent>>;
      try {
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
        mapped = answer;
      } catch (err) {
        toast.error(
          `Couldn't move it to ${target.displayLabel || "Google"}: ${reason(err, "Google refused.")}`,
        );
        return;
      }
      const googleRow = () =>
        latest.current.events.find(
          (e) => e.sourceAccountId === target.id && e.externalEventId === mapped.externalEventId,
        );

      // 2. The mirror keeps Google's answer; if it can't, Google's copy goes again.
      try {
        await runtime.calendar.mirrorEvents({
          workspaceId,
          accountId: target.id,
          events: [mapped],
          deletedExternalIds: [],
        });
      } catch (err) {
        await removeGoogleWebEvent({
          externalAccountId: target.externalId,
          calendarId: mapped.calendarId || target.externalId,
          eventId: mapped.externalEventId,
        }).catch(() => undefined);
        toast.error(reason(err, "Couldn't move the event."));
        return;
      }

      // 3. Only now does the Moduo row go; if it won't, the Google copy does.
      try {
        await runtime.calendar.removeEvent({ workspaceId, eventId: source.id });
      } catch (err) {
        await latest.current.reload();
        const row = googleRow();
        if (row) await latest.current.deleteEvent(row.id, { quiet: true });
        toast.error(reason(err, "Couldn't move the event."));
        return;
      }
      await calendar.reload();

      recordUndo(
        `Moved to ${target.displayLabel || "Google"}`,
        async () => {
          const row = googleRow();
          if (row) await latest.current.deleteEvent(row.id, { quiet: true });
          await runtime.calendar.restoreEvent({ workspaceId, eventId: source.id });
          await latest.current.reload();
        },
        { toast: true, description: source.title },
      );
    },
    [calendar, runtime, workspaceId, userId],
  );
}
