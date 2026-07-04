/**
 * Presence facepile (Wave-3 NO-6, AC7): who else is viewing this note, right
 * now. Renders nothing when you're alone — presence is a quiet ambient signal,
 * not persistent chrome. Names/initials come from the realtime channel's
 * presence payload (see `useNoteRealtime`).
 */

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NoteViewer } from "../sync/notes-realtime";

const MAX_SHOWN = 3;

export function NotePresenceAvatars({ viewers }: { viewers: NoteViewer[] }) {
  if (viewers.length === 0) return null;
  const shown = viewers.slice(0, MAX_SHOWN);
  const hidden = viewers.slice(MAX_SHOWN);
  const overflow = hidden.length;

  return (
    <AvatarGroup aria-label={`${viewers.length} ${viewers.length === 1 ? "person" : "people"} viewing`}>
      {shown.map((v) => (
        <Tooltip key={v.userId}>
          <TooltipTrigger asChild>
            <Avatar size="sm">
              <AvatarFallback>{v.initials}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent side="bottom">{v.name} is viewing</TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <AvatarGroupCount className="text-xs">+{overflow}</AvatarGroupCount>
          </TooltipTrigger>
          <TooltipContent side="bottom">{hidden.map((v) => v.name).join(", ")}</TooltipContent>
        </Tooltip>
      ) : null}
    </AvatarGroup>
  );
}
