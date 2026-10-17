import { PersonAvatar } from "../../../components/ui/avatar";
import type { Assignee } from "../assignees";

/**
 * A task's assignee as the kit's `PersonAvatar` (DS-6): their profile photo
 * when they have one (MOD-96), else two initials on a stable colour keyed on
 * their id (call 43; from the person's own name, never the value "You"; "?"
 * when they haven't set one or have left), or the dashed "unassigned" ring
 * when there is nobody. `size="icon"` sits on the icon rung
 * (rows, cards, pickers, the queue mark). Decorative: the name always sits
 * beside it or in its wrapper's label.
 */
export function AssigneeAvatar({
  assignee,
  assigneeId,
  size = "sm",
  className,
}: {
  assignee: Assignee | null;
  /** The task's assignee id: set but unknown (a former member) draws "?" on
   *  gray, never the empty "unassigned" ring. */
  assigneeId?: string | null;
  size?: "sm" | "icon";
  className?: string;
}) {
  // Initials come from the person's own name, never "You" (TV-P0, MOD-137);
  // someone without a name, or a former member, is "?" on gray.
  const name = assignee ? assignee.fullName || "?" : assigneeId ? "?" : null;
  return (
    <PersonAvatar
      name={name}
      id={assignee?.userId}
      src={assignee?.avatarUrl}
      size={size}
      className={className}
    />
  );
}
