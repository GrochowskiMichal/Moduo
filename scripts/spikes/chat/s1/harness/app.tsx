// CV-0 spike 1: the harness page. Holds the window of the fixture the stream
// shows and exposes a control the scenario runner drives; the buttons are for
// the manual checks (real trackpad momentum, Safari, WebView2).

import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";

import { arrival, COUNT, editGrowth, MESSAGES, type Msg, SCENARIO_CHAINS } from "./fixture";
import {
  DENSITIES,
  type Density,
  RECOMMENDED,
  type StreamApi,
  type StreamConfig,
  type StreamProps,
  windowRows,
} from "./model";
import { STREAMS } from "./streams";

export type HarnessState = {
  mount: number;
  lib: string;
  config: StreamConfig;
  lo: number;
  hi: number;
  arrivals: readonly Msg[];
  folded: ReadonlySet<string>;
  edits: ReadonlyMap<string, string>;
  density: Density;
  initial: StreamProps["initial"];
  edgeContext: boolean;
  status: string;
};

export interface Control {
  state(): HarnessState;
  /** Apply a change and commit it synchronously (as a store update would). */
  set(patch: Partial<HarnessState> | ((s: HarnessState) => Partial<HarnessState>)): void;
  api(): StreamApi | null;
  waitApi(): Promise<StreamApi>;
}

let current: HarnessState | null = null;
let setter: ((s: HarnessState) => void) | null = null;
let streamApi: StreamApi | null = null;
let apiWaiters: Array<(api: StreamApi) => void> = [];

function onApi(api: StreamApi | null) {
  streamApi = api;
  if (api) {
    const waiters = apiWaiters;
    apiWaiters = [];
    for (const w of waiters) w(api);
  }
}

export const control: Control = {
  state: () => current as HarnessState,
  set: (patch) => {
    const s = current as HarnessState;
    const next = { ...s, ...(typeof patch === "function" ? patch(s) : patch) };
    current = next;
    flushSync(() => setter?.(next));
  },
  api: () => streamApi,
  waitApi: () =>
    streamApi ? Promise.resolve(streamApi) : new Promise((resolve) => apiWaiters.push(resolve)),
};

let arrivalTimer: ReturnType<typeof setInterval> | null = null;
/** Manual check: a message a second until pressed again. */
function toggleArrivals() {
  if (arrivalTimer) {
    clearInterval(arrivalTimer);
    arrivalTimer = null;
    return;
  }
  arrivalTimer = setInterval(() => {
    control.set((s) => ({
      arrivals: [...s.arrivals, arrival(s.arrivals.length % 3 ? "short" : "long")],
    }));
  }, 1000);
}

export function initialState(lib: string): HarnessState {
  return {
    mount: 1,
    lib,
    config: RECOMMENDED,
    lo: COUNT - 50,
    hi: COUNT,
    arrivals: [],
    folded: new Set(),
    edits: new Map(),
    density: "comfortable",
    initial: { kind: "end" },
    edgeContext: true,
    status: "manual",
  };
}

export function App({ start }: { start: HarnessState }) {
  const [state, setState] = useState<HarnessState>(start);
  useLayoutEffect(() => {
    current = state;
  });
  useLayoutEffect(() => {
    setter = setState;
    return () => {
      setter = null;
    };
  }, []);

  const Stream = STREAMS[state.lib] ?? STREAMS.tanstack;
  const rows = windowRows(
    state.lo,
    state.hi,
    state.arrivals,
    state.folded,
    state.edits,
    state.edgeContext,
  );

  const manual = state.status === "manual";
  const act = (patch: (s: HarnessState) => Partial<HarnessState>) => control.set(patch);

  return (
    <div className="s1-app">
      <div className="s1-bar">
        <span className="s1-status" data-status={state.status}>
          {state.lib} · {state.config.id} · {state.density} · rows {rows.length} · {state.status}
        </span>
        {manual ? (
          <span className="s1-actions">
            {/* Only where the Legend variant exists (t/maciej/cv-0-s1-legend). */}
            {STREAMS.legend ? (
              <button
                type="button"
                onClick={() =>
                  act((s) => ({
                    lib: s.lib === "tanstack" ? "legend" : "tanstack",
                    mount: s.mount + 1,
                  }))
                }
              >
                Switch library
              </button>
            ) : null}
            <button type="button" onClick={() => act((s) => ({ lo: Math.max(0, s.lo - 50) }))}>
              Prepend 50
            </button>
            <button
              type="button"
              onClick={() => act((s) => ({ arrivals: [...s.arrivals, arrival()] }))}
            >
              New message
            </button>
            <button type="button" onClick={toggleArrivals}>
              Arrivals 1/s
            </button>
            <button
              type="button"
              onClick={() =>
                act((s) => {
                  const id = (MESSAGES[SCENARIO_CHAINS.end] as Msg).id;
                  const folded = new Set(s.folded);
                  if (folded.has(id)) folded.delete(id);
                  else folded.add(id);
                  return { folded };
                })
              }
            >
              Fold chain
            </button>
            <button
              type="button"
              onClick={() => {
                const s = control.state();
                const next = DENSITIES[
                  (DENSITIES.indexOf(s.density) + 1) % DENSITIES.length
                ] as Density;
                // TanStack: keep the reader's row in place in the same frame.
                control.api()?.setDensityAnchored?.(next);
                act(() => ({ density: next }));
              }}
            >
              Density
            </button>
            <button
              type="button"
              onClick={() =>
                act((s) => {
                  const last = MESSAGES[s.hi - 1] as Msg;
                  const edits = new Map(s.edits);
                  edits.set(last.id, editGrowth());
                  return { edits };
                })
              }
            >
              Edit last
            </button>
            <button
              type="button"
              onClick={() =>
                act((s) => ({
                  lo: 4_900,
                  hi: 5_100,
                  arrivals: [],
                  mount: s.mount + 1,
                  initial: { kind: "key", key: (MESSAGES[5_000] as Msg).id },
                }))
              }
            >
              Jump to 5,000
            </button>
            <button
              type="button"
              onClick={() =>
                act((s) => ({
                  lo: COUNT - 50,
                  hi: COUNT,
                  mount: s.mount + 1,
                  initial: { kind: "end" },
                }))
              }
            >
              Back to present
            </button>
          </span>
        ) : null}
      </div>
      <div className="s1-stage">
        <div className="s1-column">
          <Stream
            key={state.mount}
            rows={rows}
            density={state.density}
            config={state.config}
            initial={state.initial}
            onApi={onApi}
          />
        </div>
      </div>
    </div>
  );
}
