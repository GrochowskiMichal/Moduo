import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { cn } from "../../../lib/utils";
import { type Assignee, initialsOf } from "../assignees";

/**
 * Small round avatar for a task's assignee; empty slot when unassigned.
 * `size="icon"` sits on the icon rung (rows, cards, the queue mark) and shows
 * one initial, which is all that fits.
 */
export function AssigneeAvatar({
  assignee,
  size = "sm",
  className,
}: {
  assignee: Assignee | null;
  size?: "sm" | "icon";
  className?: string;
}) {
  const initials = assignee ? initialsOf(assignee.name) : "?";
  return (
    <Avatar size={size} className={cn(size === "sm" && "size-5", className)}>
      {assignee?.avatarUrl ? <AvatarImage src={assignee.avatarUrl} alt="" /> : null}
      <AvatarFallback className={size === "sm" ? "text-2xs" : undefined}>
        {size === "icon" ? initials.slice(0, 1) : initials}
      </AvatarFallback>
    </Avatar>
  );
}
