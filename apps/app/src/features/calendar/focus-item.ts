// Focus time (CALR-14, AC23): its own calendar item (kind "focus") that can
// hold a task. Busy to teammates (they see "Focus time"), free for booking
// links unless a link ticks it. Pure rules; the server masks.

const MIN = 60_000;

/** Focus time without an estimate runs two hours. */
export const FOCUS_DEFAULT_MINUTES = 120;

/** What focus time is called when it has no title of its own, and what teammates see. */
export const FOCUS_TIME_TITLE = "Focus time";

export function isFocusItem(item: { kind?: string | null }): boolean {
  return item.kind === "focus";
}

/** The task's estimate, or two hours without one. */
export function focusMinutes(task: { durationMinutes?: number | null }): number {
  const d = task.durationMinutes;
  return d && d > 0 ? d : FOCUS_DEFAULT_MINUTES;
}

/** The draft that creates focus time holding `task`, from `startMs` for `minutes`. */
export function focusDraftForTask(
  task: { id: string; title: string },
  startMs: number,
  minutes: number,
) {
  return {
    title: task.title.trim() || FOCUS_TIME_TITLE,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(startMs + minutes * MIN).toISOString(),
    kind: "focus" as const,
    focusTaskId: task.id,
  };
}

/** A one-line chip's title: "Focus · title", never "Focus · Focus time". */
export function focusChipTitle(title: string, focus: boolean): string {
  return focus && title !== FOCUS_TIME_TITLE ? `Focus · ${title}` : title;
}
