// "What's in Tasks" from outside the Tasks page (TV-U17): the top bar's Help
// menu reopens Tasks' welcome. A one-shot flag covers a /tasks that isn't
// mounted yet (consumed on mount); a window event covers one that is. Both
// consume the flag, so a stranded flag can't open the welcome on a later,
// unrelated visit. Same shape as features/focus/view-request.ts.

export const TASKS_WELCOME_REQUEST_EVENT = "moduo:tasks:welcome";

let welcomeRequested = false;

/** Help → "What's in Tasks". */
export function requestTasksWelcome(): void {
  welcomeRequested = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TASKS_WELCOME_REQUEST_EVENT));
  }
}

/** Read-and-clear the one-shot "open the welcome" flag. */
export function consumeTasksWelcomeRequest(): boolean {
  const requested = welcomeRequested;
  welcomeRequested = false;
  return requested;
}
