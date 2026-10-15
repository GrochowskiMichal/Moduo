// The next meeting for Focus's divider (Tasks v3 TV-F8, call 64): my own
// calendar's events for the next day, read on opening Focus and every five
// minutes after, then looked at each minute. Calendar is another module: a
// read that fails (no access, offline) just means no divider.

import { useEffect, useMemo, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { CalendarEventModel } from "../../calendar/events";
import { type NextMeeting, nextMeeting } from "../focus-screen";
import { useMinuteTick } from "../use-today";

const REFRESH_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export function useNextMeeting(input: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  me: string | null;
  /** How far ahead the line-up runs (ms); the divider looks at least two hours ahead. */
  horizonMs: number;
  enabled: boolean;
}): NextMeeting | null {
  const { runtime, workspaceId, me, horizonMs, enabled } = input;
  const [events, setEvents] = useState<readonly CalendarEventModel[]>([]);

  useEffect(() => {
    if (!enabled || !runtime || !workspaceId || !me) {
      setEvents([]);
      return;
    }
    let alive = true;
    const read = () => {
      const now = Date.now();
      runtime.calendar
        .listModule(workspaceId, {
          fromIso: new Date(now - DAY_MS).toISOString(),
          toIso: new Date(now + DAY_MS).toISOString(),
        })
        .then((bundle) => {
          if (alive) setEvents(bundle.events);
        })
        .catch(() => {
          // No calendar here (access, offline, an older desktop runtime): no divider.
        });
    };
    read();
    const id = window.setInterval(read, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled, runtime, workspaceId, me]);

  const tick = useMinuteTick(enabled && events.length > 0);
  return useMemo(() => {
    void tick;
    if (!enabled || events.length === 0) return null;
    return nextMeeting(events, { me, nowMs: Date.now(), horizonMs });
  }, [enabled, events, me, horizonMs, tick]);
}
