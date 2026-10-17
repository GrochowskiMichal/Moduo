// The status icons (REPLAN 53a, Maciej's rule): an icon belongs to the
// category, never to a project's own status, and nobody edits them.
//   Backlog     — a dotted circle
//   To do       — an empty circle
//   In progress — a half-filled circle (In review, Drafting, Editing… alike)
//   Done        — a check
//   Won't do    — a crossed circle
// Drawn on lucide's grid (24 px box, r 10, 2 px stroke) so they sit with the
// app's other icons; colour comes from the text colour (currentColor).

import type { TaskStatusCategory } from "@contracts/vocabularies";
import { cn } from "../../../lib/utils";
import { CATEGORY_LABELS } from "../statuses";

export function StatusIcon({
  category,
  className,
  title,
}: {
  category: TaskStatusCategory;
  className?: string;
  /** Spoken name; without it the icon is decorative (aria-hidden). */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-icon-sm shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-status-category={category}
    >
      {category === "backlog" ? (
        <circle cx="12" cy="12" r="10" strokeDasharray="2.6 3.6" />
      ) : (
        <circle cx="12" cy="12" r="10" />
      )}
      {category === "in_progress" ? (
        <path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none" />
      ) : null}
      {category === "done" ? <path d="m9 12 2 2 4-4" /> : null}
      {category === "wont_do" ? (
        <>
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        </>
      ) : null}
    </svg>
  );
}

/** A task's status icon, named for screen readers by its status name. */
export function TaskStatusIcon({
  category,
  name,
  className,
}: {
  category: TaskStatusCategory;
  /** The project's own name for it; the category's when absent. */
  name?: string;
  className?: string;
}) {
  return (
    <StatusIcon
      category={category}
      className={className}
      title={name ?? CATEGORY_LABELS[category]}
    />
  );
}
