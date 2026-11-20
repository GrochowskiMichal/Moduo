// The task deep link (DF-1, MOD-28) as one state machine. Pure: the hook
// (`use-task-deep-link.ts`) feeds it events and carries out its commands.
//
// The cursor is React state, mirrored into `?id=` at rest (a j/k key-repeat
// cursor mustn't ride the router, and WebKit throttles `replaceState`). So an
// id in the address bar is either the mirror's own write coming back, or an
// INBOUND link (a widget row, a chip, a notification, a refresh, Back or
// Forward) to apply once the bundle can answer it:
//
//   idle ──urlChanged──▶ awaitingLoad ──evaluate──▶ resolved
//                         │    ▲                        (open, snap, gone)
//                         ▼    │ retry
//                  awaitingHandle ──handleFailed──▶ failed ──cursorMoved──▶ resolved
//                         │
//                         └──handleResolved──▶ (follows to the task's id)
//
// While a link waits (awaitingLoad, awaitingHandle, failed), nothing else
// may move the cursor or the address bar: the backstop's pick, the mirror's
// write and the default place all hold (`linkSettled`). That ordering is the
// machine's, not a comment's.

import type { HandleLinkStep, TasksDeepLinkTarget } from "../../search";

/** A handle link whose lookup failed is asked again this often (MOD-28). */
export const HANDLE_RETRY_MS = 30_000;

export type DeepLinkPhase =
  /** Nothing inbound: the address bar's id, if any, is the cursor's. */
  | { kind: "idle" }
  /** An inbound link, waiting for the bundle (or for Done, Won't do and Backlog). */
  | { kind: "awaitingLoad"; id: string; external: boolean }
  /** A handle (`?id=MOD-142`) being found: here, else on the server. */
  | { kind: "awaitingHandle"; handle: string; external: boolean }
  /** The link was applied (or the id was the mirror's own). */
  | { kind: "resolved"; id: string }
  /**
   * The server couldn't answer for a handle (offline, an error): it stays in
   * the address bar, asked again at `retryAt` or when the connection comes
   * back, until the cursor moves off `cursor` (you moved on).
   */
  | {
      kind: "failed";
      handle: string;
      external: boolean;
      retryAt: number;
      cursor: string | null;
    };

export type DeepLinkState = {
  phase: DeepLinkPhase;
  /** The id the address bar holds, as last seen. */
  url: string | null;
  /** The id the mirror wrote last: arriving back, it's not a link. */
  selfWrote: string | null;
};

export const DEEP_LINK_START: DeepLinkState = {
  phase: { kind: "idle" },
  url: null,
  selfWrote: null,
};

/** What a link can be answered from. Pure functions of the loaded bundle. */
export type DeepLinkWorld = {
  /** The bundle loaded cleanly (a failed read's empty bundle can't answer). */
  ready: boolean;
  /** Done, Won't do and Backlog tasks are in too (the shared store, TV-D11a). */
  restLoaded: boolean;
  /** A handle's next step against the loaded tasks; null when `id` isn't a handle. */
  handleStep: (id: string) => HandleLinkStep | null;
  /** A task or project id's target. */
  target: (id: string) => TasksDeepLinkTarget;
  /** The place open now already shows this task (no scope snap). */
  inScope: (taskId: string) => boolean;
  /** The server can be asked for a handle (outside the app shell it can't). */
  canLookup: boolean;
};

export type DeepLinkEvent =
  /** The address bar's id changed; `intent` is a "take me there" mark (entity-open). */
  | { type: "urlChanged"; id: string | null; intent: boolean }
  /** The bundle changed: a waiting link may now be answered. */
  | { type: "evaluate"; world: DeepLinkWorld }
  | { type: "handleResolved"; handle: string; taskId: string | null }
  | { type: "handleFailed"; handle: string; now: number; cursor: string | null }
  /** The failed handle's retry is due (the timer, or back online). */
  | { type: "retry" }
  | { type: "cursorMoved"; id: string | null }
  | { type: "mirrorWritten"; id: string | null };

export type DeepLinkCommand =
  /** Select the task; snap the place to `snapTo` first when it isn't shown there. */
  | { kind: "openTask"; taskId: string; snapTo: string | null; external: boolean }
  /** A project link: open that place, leaving the pick to the backstop. */
  | { kind: "openPlace"; place: string }
  /** Nothing you can open: a followed link says so, a stale one clears quietly. */
  | { kind: "gone"; id: string; external: boolean }
  /** Ask the server which task a handle names. */
  | { kind: "lookup"; handle: string }
  /** Replace the handle in the address bar with its task's id (or clear it). */
  | { kind: "follow"; handle: string; taskId: string | null; external: boolean };

export type DeepLinkStep = { state: DeepLinkState; commands: DeepLinkCommand[] };

const none = (state: DeepLinkState): DeepLinkStep => ({ state, commands: [] });

/** Nothing inbound waits: the backstop, the mirror and the default place may act. */
export function linkSettled(state: DeepLinkState): boolean {
  return state.phase.kind === "idle" || state.phase.kind === "resolved";
}

/** The machine's state for a render whose address bar may be newer than its last event. */
export function deepLinkAt(state: DeepLinkState, url: string | null): DeepLinkState {
  return state.url === url
    ? state
    : deepLinkReducer(state, { type: "urlChanged", id: url, intent: false }).state;
}

export function deepLinkReducer(state: DeepLinkState, event: DeepLinkEvent): DeepLinkStep {
  const { phase } = state;
  switch (event.type) {
    case "urlChanged": {
      const { id } = event;
      if (id === null) return none({ ...state, url: null, phase: { kind: "idle" } });
      if (id === state.selfWrote) {
        return none({ ...state, url: id, phase: { kind: "resolved", id } });
      }
      return none({
        ...state,
        url: id,
        phase: { kind: "awaitingLoad", id, external: event.intent },
      });
    }
    case "evaluate":
      return phase.kind === "awaitingLoad" ? evaluate(state, phase, event.world) : none(state);
    case "handleResolved": {
      // A late answer for a link the address bar has moved on from is dropped.
      if (phase.kind !== "awaitingHandle" || phase.handle !== event.handle) return none(state);
      return {
        state,
        commands: [
          {
            kind: "follow",
            handle: phase.handle,
            taskId: event.taskId,
            external: phase.external,
          },
        ],
      };
    }
    case "handleFailed": {
      if (phase.kind !== "awaitingHandle" || phase.handle !== event.handle) return none(state);
      return none({
        ...state,
        phase: {
          kind: "failed",
          handle: phase.handle,
          external: phase.external,
          retryAt: event.now + HANDLE_RETRY_MS,
          cursor: event.cursor,
        },
      });
    }
    case "retry":
      if (phase.kind !== "failed") return none(state);
      return none({
        ...state,
        phase: { kind: "awaitingLoad", id: phase.handle, external: phase.external },
      });
    case "cursorMoved":
      // Picking a task while a failed handle waits lets the link go: a later
      // answer mustn't pull the selection back (MOD-28).
      if (phase.kind !== "failed" || event.id === phase.cursor) return none(state);
      return none({ ...state, phase: { kind: "resolved", id: phase.handle } });
    case "mirrorWritten":
      return none({ ...state, selfWrote: event.id });
  }
}

function evaluate(
  state: DeepLinkState,
  phase: Extract<DeepLinkPhase, { kind: "awaitingLoad" }>,
  world: DeepLinkWorld,
): DeepLinkStep {
  // A failed read leaves an empty bundle: resolving against it would strip a
  // valid link, so it waits until Retry succeeds.
  if (!world.ready) return none(state);
  const { id, external } = phase;
  const step = world.handleStep(id);
  // Done, Won't do and Backlog tasks arrive after the open ones: a link to
  // one waits for them before it reads as gone. A handle too (MOD-28).
  const waits = step ? step.kind === "wait" : !world.restLoaded && world.target(id).kind === "none";
  if (waits) return none(state);

  if (step) {
    // A handle: find its task (here, archived projects' too, else on the
    // server, which knows the old keys), then follow the task's own id.
    const next: DeepLinkState = {
      ...state,
      phase: { kind: "awaitingHandle", handle: id, external },
    };
    if (step.kind === "task") {
      return {
        state: next,
        commands: [{ kind: "follow", handle: id, taskId: step.taskId, external }],
      };
    }
    // Outside the app shell there's no lookup: what's loaded is all there is.
    if (!world.canLookup) {
      return { state: next, commands: [{ kind: "follow", handle: id, taskId: null, external }] };
    }
    return { state: next, commands: [{ kind: "lookup", handle: id }] };
  }

  const resolved: DeepLinkState = { ...state, phase: { kind: "resolved", id } };
  const target = world.target(id);
  switch (target.kind) {
    case "none":
      return { state: resolved, commands: [{ kind: "gone", id, external }] };
    case "bucket":
      return { state: resolved, commands: [{ kind: "openPlace", place: target.scope }] };
    case "task":
      return {
        state: resolved,
        commands: [
          {
            kind: "openTask",
            taskId: target.taskId,
            // The place snaps to the task's project unless it already shows it.
            snapTo: world.inScope(target.taskId) ? null : target.scope,
            external,
          },
        ],
      };
  }
}
