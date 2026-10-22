// What Upcoming, My tasks, All and Won't do say with nothing in them
// (tasks-v3 §8 "first run teaches one gesture", research §9; TV-U15). A new
// person's first look at Tasks is one of these (the hackathon brief), so each
// names what the view is for and the one way to fill it. The Inbox's own is
// in inbox-view.tsx. Kit EmptyState only.

import { Ban, CalendarDays, Layers, Plus, UserRound } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Kbd } from "../../../components/ui/kbd";

/** Upcoming with nothing dated (research §9). */
export function UpcomingEmpty({
  canEdit,
  onAddToday,
}: {
  canEdit: boolean;
  /** Capture a task due today. */
  onAddToday: () => void;
}) {
  return (
    <EmptyState
      icon={CalendarDays}
      title="Nothing dated yet"
      description="Tasks with a due date or a work session show here, by day."
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={onAddToday}>
            <Plus aria-hidden />
            Add a task for today
          </Button>
        ) : undefined
      }
      hint={canEdit ? "Type “tomorrow” or “fri 3pm” in a task’s name to date it." : undefined}
    />
  );
}

/** My tasks with nothing assigned to you. */
export function MyTasksEmpty({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  return (
    <EmptyState
      icon={UserRound}
      title="Nothing assigned to you"
      description="Tasks you take on show here by status, what you’re in the middle of first."
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <Plus aria-hidden />
            Add a task
          </Button>
        ) : undefined
      }
      hint={
        canEdit ? (
          <>
            or press <Kbd>c</Kbd>; <Kbd>@</Kbd> in a task’s name assigns it
          </>
        ) : undefined
      }
    />
  );
}

/** All with no projects yet, or none with open work. */
export function AllEmpty({ hasProjects }: { hasProjects: boolean }) {
  return hasProjects ? (
    <EmptyState
      icon={Layers}
      title="No open tasks in your projects"
      description="Everything your projects hold shows here, project by project."
    />
  ) : (
    <EmptyState
      icon={Layers}
      title="No projects yet"
      description="Projects hold the work you share. Make one with New project at the end of the sidebar."
    />
  );
}

/** Won't do with nothing in it. */
export function WontDoEmpty() {
  return (
    <EmptyState
      icon={Ban}
      title="Nothing marked Won’t do"
      description="Tasks you decide not to do land here. Reopen brings one back."
    />
  );
}
