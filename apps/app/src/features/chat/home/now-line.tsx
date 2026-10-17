// Chat's "now" line in Home's Team widget (CV-22, CH70, prototype round 5
// frame 8): Active · Focusing on … · until … · Away · a status ("🌴 On vacation
// until Oct 20"), from `chat_now` (CV-17) and presence on the workspace's chat
// topic. Both are read as the signed-in viewer: `chat_now` answers members
// only, with a task only when its person shares it and the viewer can see it,
// and the presence topic is members only. Nothing to say draws nothing.

import { useChatPresence } from "@/features/chat/store/react";
import type { TeamNowLineProps } from "@/features/dashboard/team-now";
import { nowLine, type PersonNow, type PresenceState, presenceStateOf } from "@/lib/statuses/model";
import { usePeopleNow } from "@/lib/statuses/store";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

/** The line's words: the status, Focusing, Away, or Active when reachable. */
export function teamNowText(
  person: PersonNow | undefined,
  state: PresenceState,
  now: Date = new Date(),
): string {
  const line = nowLine(person, state, now, { task: true });
  if (line) return line;
  return state === "reachable" ? "Active" : "";
}

export function ChatNowLine({ workspaceId, userId, size }: TeamNowLineProps) {
  const { userId: viewerId } = useAuth();
  const peopleNow = usePeopleNow(viewerId, workspaceId);
  const presence = useChatPresence(workspaceId, viewerId, Boolean(viewerId));
  const person = peopleNow.people.get(userId);
  const state = presenceStateOf({
    online: presence.online.has(userId),
    away: presence.away.has(userId),
    dnd: person?.dnd,
    focusing: person?.focusing,
  });
  const text = teamNowText(person, state);
  if (!text) return null;
  return (
    <span
      data-team-now=""
      className={cn(
        "min-w-0 text-xs text-muted-foreground",
        size === "S" ? "truncate" : "line-clamp-2",
      )}
    >
      {text}
    </span>
  );
}
