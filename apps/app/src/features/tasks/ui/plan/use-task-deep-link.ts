// Drives the deep-link machine (`deep-link.ts`) for the plan view: the
// address bar's `?id=`, the bundle that answers it, a handle's server lookup
// and its retry, and the cursor's debounced mirror back into the address bar.
//
// Two hooks, because the page needs the machine's verdict (`settled`) before
// it has built what a link is answered from (the place's tasks): the machine
// first, its wiring later in the same render.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { markEntityOpenIntent, takeEntityOpenIntent } from "../../../../lib/entity-open";
import { lookupHandleLink } from "../../search";
import {
  DEEP_LINK_START,
  deepLinkAt,
  type DeepLinkCommand,
  type DeepLinkEvent,
  deepLinkReducer,
  type DeepLinkState,
  type DeepLinkWorld,
  linkSettled,
} from "./deep-link";

// The cursor→URL mirror writes only at rest: the URL only needs to be right
// then, and WebKit throttles history.replaceState (~100 calls/30s), so an
// undebounced j/k key-repeat cursor would trip a SecurityError in the
// desktop webview.
export const URL_MIRROR_DEBOUNCE_MS = 250;

export type DeepLinkMachine = {
  /** The machine as of this render's address bar (see `deepLinkAt`). */
  state: DeepLinkState;
  /** No inbound link waits: the backstop, the mirror and the default place may act. */
  settled: boolean;
  /** @internal the state as of the last event, for the wiring below. */
  current: { value: DeepLinkState };
  /** @internal */
  setState: (state: DeepLinkState) => void;
};

/**
 * The machine, read at render: an address bar newer than the last event is
 * read as its `urlChanged` already, so every effect in the flush that brings
 * a link sees it waiting (nothing steals or overwrites it first).
 */
export function useDeepLinkMachine(urlTaskId: string | null): DeepLinkMachine {
  const [stored, setState] = useState(DEEP_LINK_START);
  const current = useRef({ value: stored }).current;
  const state = deepLinkAt(stored, urlTaskId);
  return { state, settled: linkSettled(state), current, setState };
}

/** What a command opens, carried out by the page. */
export type DeepLinkApply = Extract<
  DeepLinkCommand,
  { kind: "openTask" } | { kind: "openPlace" } | { kind: "gone" }
>;

export type TaskDeepLinkInput = {
  urlTaskId: string | null;
  /** Writes `?id=` (replace). */
  onUrlTaskIdChange: (id: string | null) => void;
  world: DeepLinkWorld;
  /** Asks the server which task a handle names (the reference store's). */
  lookup: ((handle: string) => Promise<string | null>) | null;
  /** The bundle has loaded: the mirror waits for it. */
  loaded: boolean;
  /** The cursor and what the address bar names it by (its handle, else its id). */
  selectedTaskId: string | null;
  selectedLinkId: string | null;
  /** Open what a link names; a followed link to what you can't open says so. */
  onApply: (command: DeepLinkApply) => void;
  /** A followed handle you can't open: the panel's "Private item". */
  onPrivate: (handle: string) => void;
};

export function useTaskDeepLink(machine: DeepLinkMachine, input: TaskDeepLinkInput): void {
  const { urlTaskId, onUrlTaskIdChange, world, loaded, selectedTaskId, selectedLinkId } = input;
  const { current, setState } = machine;
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });

  // Stable: a step, then its commands (a lookup's answer steps again).
  const run = useCallback(
    function run(event: DeepLinkEvent): void {
      let step = deepLinkReducer(current.value, event);
      let commands = step.commands;
      // A link that starts waiting is answered at once when the bundle can.
      if (event.type !== "evaluate" && step.state.phase.kind === "awaitingLoad") {
        const answered = deepLinkReducer(step.state, {
          type: "evaluate",
          world: latest.current.world,
        });
        step = answered;
        commands = [...commands, ...answered.commands];
      }
      if (step.state !== current.value) {
        current.value = step.state;
        setState(step.state);
      }
      for (const command of commands) carryOut(command);

      function carryOut(command: DeepLinkCommand): void {
        const io = latest.current;
        switch (command.kind) {
          case "lookup": {
            const ask = io.lookup;
            if (!ask) return;
            void lookupHandleLink(command.handle, ask).then((answer) => {
              if (answer.kind === "failed") {
                run({
                  type: "handleFailed",
                  handle: command.handle,
                  now: Date.now(),
                  cursor: latest.current.selectedTaskId,
                });
                return;
              }
              run({
                type: "handleResolved",
                handle: command.handle,
                taskId: answer.kind === "task" ? answer.taskId : null,
              });
            });
            return;
          }
          case "follow":
            // A handle the server says you can't open is a "Private item"; one it
            // found becomes the task's own id, keeping a "take me there" mark.
            if (!command.taskId) {
              if (command.external) io.onPrivate(command.handle);
              io.onUrlTaskIdChange(null);
              return;
            }
            if (command.external) markEntityOpenIntent(command.taskId);
            io.onUrlTaskIdChange(command.taskId);
            return;
          case "gone":
            io.onApply(command);
            io.onUrlTaskIdChange(null);
            return;
          default:
            io.onApply(command);
        }
      }
    },
    [current, setState],
  );

  // The address bar's id moved: a link, or the mirror's own write back. A
  // fresh external open (marked by the app chrome) is "take me there".
  useEffect(() => {
    if (current.value.url === urlTaskId) return;
    run({
      type: "urlChanged",
      id: urlTaskId,
      intent: urlTaskId ? takeEntityOpenIntent(urlTaskId) : false,
    });
  }, [urlTaskId, current, run]);

  // The bundle changed: a waiting link may be answered now.
  useEffect(() => {
    run({ type: "evaluate", world });
  }, [world, run]);

  // A failed handle is asked again every half minute, or when the
  // connection comes back.
  const phase = machine.state.phase;
  const retryAt = phase.kind === "failed" ? phase.retryAt : null;
  useEffect(() => {
    if (retryAt === null) return;
    const again = () => run({ type: "retry" });
    const id = window.setTimeout(again, Math.max(0, retryAt - Date.now()));
    window.addEventListener("online", again);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("online", again);
    };
  }, [retryAt, run]);

  useEffect(() => {
    run({ type: "cursorMoved", id: selectedTaskId });
  }, [selectedTaskId, run]);

  // Mirror the cursor → URL (replace) so refresh keeps it, trailing-debounced
  // and only while no link waits (a target is never overwritten before it's
  // honored). The URL names the task by its handle when it has one (MOD-28);
  // a link that arrived by id is rewritten to the handle once it's selected,
  // and the machine reads that back as the mirror's own write.
  const settled = machine.settled;
  useEffect(() => {
    if (!loaded || !settled) return;
    if (selectedLinkId === (urlTaskId ?? null)) return;
    const id = window.setTimeout(() => {
      if (!linkSettled(current.value)) return;
      run({ type: "mirrorWritten", id: selectedLinkId });
      onUrlTaskIdChange(selectedLinkId);
    }, URL_MIRROR_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [loaded, settled, selectedLinkId, urlTaskId, onUrlTaskIdChange, current, run]);
}
