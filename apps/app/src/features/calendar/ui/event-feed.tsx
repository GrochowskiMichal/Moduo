// The event panel's Activity: the same feed as a task's (All · Comments, the
// trail and comments, the pinned comment box), with an event's trail in its
// own words. The trail is read again whenever the event changes.

import { useEffect, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { spineActorName } from "../../spine/activity";
import type { ActivityEntry } from "../../tasks/model";
import { EntityFeed, type FeedWords } from "../../tasks/ui/task-feed";
import { calendarActivityLine } from "../activity";
import type { CalendarEventModel } from "../events";

const NO_ACTIVITY: ActivityEntry[] = [];
const NO_TEAMS: never[] = [];
const EVENT_WORDS: FeedWords = { line: calendarActivityLine, actor: spineActorName };

export function EventFeed({
  runtime,
  workspaceId,
  currentUserId,
  event,
  composerSlot,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  currentUserId: string | null;
  event: Pick<CalendarEventModel, "id" | "title" | "createdAt" | "updatedAt">;
  composerSlot: HTMLElement | null;
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
        if (!cancelled) setActivity(rows);
      })
      .catch(() => {
        if (!cancelled) setActivity(NO_ACTIVITY);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, event.id, event.updatedAt]);

  return (
    <EntityFeed
      entity={{ type: "event", id: event.id, label: event.title || "Event", icon: "calendar" }}
      createOp="calendar.event_create"
      created={{ at: event.createdAt, actorId: null }}
      activity={activity}
      words={EVENT_WORDS}
      runtime={runtime}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      teams={NO_TEAMS}
      canComment={!!runtime && !!workspaceId}
      composerSlot={composerSlot}
      commentLabel="Comment on this event"
      reloadKey={event.updatedAt}
    />
  );
}
