import { Avatar, AvatarFallback, AvatarImage } from "../../../components/ui/avatar";
import { cn } from "../../../lib/utils";
import { type Assignee, initialsOf } from "../assignees";

/** Small round avatar for a task's assignee; empty slot when unassigned. */
export function AssigneeAvatar({
  assignee,
  className,
}: {
  assignee: Assignee | null;
  className?: string;
}) {
  return (
    <Avatar size="sm" className={cn("size-5", className)}>
      {assignee?.avatarUrl ? <AvatarImage src={assignee.avatarUrl} alt="" /> : null}
      <AvatarFallback className="text-2xs">
        {assignee ? initialsOf(assignee.name) : "?"}
      </AvatarFallback>
    </Avatar>
  );
}
