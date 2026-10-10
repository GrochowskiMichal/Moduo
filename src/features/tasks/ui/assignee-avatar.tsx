import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { cn } from "../../../lib/utils";
import { type Assignee, initialsOf } from "../assignees";

/**
 * Small round avatar for a task's assignee; empty slot when unassigned. Two
 * initials at every size, from the person's own name (call 43, TV-P0);
 * `size="icon"` sits on the icon rung (rows, cards, the queue mark).
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
  // Initials come from the person's own name, never the picker's "Me".
  const initials = assignee?.fullName ? initialsOf(assignee.fullName) : "?";
  return (
    <Avatar size={size} className={cn(size === "sm" && "size-5", className)}>
      {assignee?.avatarUrl ? <AvatarImage src={assignee.avatarUrl} alt="" /> : null}
      <AvatarFallback aria-hidden className={size === "sm" ? "text-2xs" : undefined}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
