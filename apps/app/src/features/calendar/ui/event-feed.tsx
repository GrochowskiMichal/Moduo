// The event panel's Activity: the event's history in a task feed's lines
// (merged runs, folds), in an event's own words. No comments: an event's talk
// happens in the meeting, its chat or a linked task. The trail is read again
// whenever the event changes.

import { useEffect, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { spineActorName } from "../../spine/activity";
import type { ActivityEntry } from "../../tasks/model";
import { ChangeFeed, type FeedWords } from "../../tasks/ui/task-feed";
import { calendarActivityLine, isEventTrailEntry } from "../activity";
import type { CalendarEventModel } from "../events";

const NO_ACTIVITY: ActivityEntry[] = [];
const EVENT_WORDS: FeedWords = { line: calendarActivityLine, actor: spineActorName };

export function EventFeed({
  runtime,
  workspaceId,
  currentUserId,
  event,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  currentUserId: string | null;
  event: Pick<CalendarEventModel, "id" | "createdAt" | "updatedAt">;
}) {
  const [activity, setActivity] = useState<ActivityEntry[]>(NO_ACTIVITY);
  useEffect(() => {
    let cancelled = false;
    if (!runtime) return;
    // Entity-scoped, module OMITTED: event activity logs under
    // module='calendar' (the CO-2 listActivity lesson).
    runtime.tasks
      .listActivity({ workspaceId, entityType: "event", entityId: event.id, limit: 100 })
      .then((rows) => {
        if (!cancelled) setActivity(rows.filter(isEventTrailEntry));
      })
      .catch(() => {
        if (!cancelled) setActivity(NO_ACTIVITY);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, event.id, event.updatedAt]);

  return (
    <ChangeFeed
      id={event.id}
      createOp="calendar.event_create"
      created={{ at: event.createdAt, actorId: null }}
      activity={activity}
      words={EVENT_WORDS}
      currentUserId={currentUserId}
    />
  );
}
