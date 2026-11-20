// `usePlanPlace` (DF-1): the address bar's `?place=` is the place; a pick
// shows before the router commits it, and the default is written only once
// it's settled and no deep link is waiting.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import { type PlanPlaceInput, usePlanPlace } from "./use-plan-place";

const WS = "ws-1";

function input(over: Partial<PlanPlaceInput> = {}): PlanPlaceInput {
  return {
    workspaceId: WS,
    urlPlace: null,
    onUrlPlaceChange: () => {},
    inboxId: "inbox-id",
    bucketIds: ["b1", "b2"],
    archivedBucketIds: [],
    viewSelections: [],
    firstView: null,
    loaded: true,
    reachedServer: true,
    holdDefault: false,
    ...over,
  };
}

afterEach(() => window.localStorage.clear());

describe("usePlanPlace", () => {
  it("opens where you left Tasks and writes it to the address bar once loaded", () => {
    window.localStorage.setItem(`moduo:tasks:lastBucket:${WS}`, "b2");
    const writes: string[] = [];
    const { result, rerender } = renderHook((p: PlanPlaceInput) => usePlanPlace(p), {
      initialProps: input({ loaded: false, onUrlPlaceChange: (p) => writes.push(p) }),
    });
    expect(result.current.place).toBe("b2");
    expect(writes).toEqual([]);
    rerender(input({ onUrlPlaceChange: (p) => writes.push(p) }));
    expect(result.current.place).toBe("b2");
    expect(writes).toEqual(["b2"]);
  });

  it("holds the default while an inbound deep link waits (the link owns the scope)", () => {
    const writes: string[] = [];
    const onUrlPlaceChange = (p: string) => writes.push(p);
    const { rerender } = renderHook((p: PlanPlaceInput) => usePlanPlace(p), {
      initialProps: input({ holdDefault: true, onUrlPlaceChange }),
    });
    expect(writes).toEqual([]);
    rerender(input({ holdDefault: false, onUrlPlaceChange }));
    expect(writes).toEqual(["inbox"]);
  });

  it("shows a pick at once, before the router commits it", () => {
    const writes: string[] = [];
    const onUrlPlaceChange = (p: string) => writes.push(p);
    const { result, rerender } = renderHook((p: PlanPlaceInput) => usePlanPlace(p), {
      initialProps: input({ urlPlace: "b1", onUrlPlaceChange }),
    });
    act(() => result.current.setPlace("b2"));
    expect(result.current.place).toBe("b2");
    expect(writes).toEqual(["b2"]);
    // The router commits; nothing more is written.
    rerender(input({ urlPlace: "b2", onUrlPlaceChange }));
    expect(result.current.place).toBe("b2");
    expect(writes).toEqual(["b2"]);
  });

  it("lets the address bar win when it moves elsewhere meanwhile", () => {
    const onUrlPlaceChange = rs.fn();
    const { result, rerender } = renderHook((p: PlanPlaceInput) => usePlanPlace(p), {
      initialProps: input({ urlPlace: "b1", onUrlPlaceChange }),
    });
    act(() => result.current.setPlace("b2"));
    rerender(input({ urlPlace: "upcoming", onUrlPlaceChange }));
    expect(result.current.place).toBe("upcoming");
  });

  it("keeps setPlace stable across writes", () => {
    const { result, rerender } = renderHook((p: PlanPlaceInput) => usePlanPlace(p), {
      initialProps: input({ urlPlace: "b1" }),
    });
    const first = result.current.setPlace;
    act(() => result.current.setPlace("b2"));
    rerender(input({ urlPlace: "b2" }));
    expect(result.current.setPlace).toBe(first);
  });

  it("remembers a place you land on, never one you pass through", () => {
    const { result, rerender } = renderHook((p: PlanPlaceInput) => usePlanPlace(p), {
      initialProps: input({ urlPlace: "b1" }),
    });
    expect(window.localStorage.getItem(`moduo:tasks:lastBucket:${WS}`)).toBe("b1");
    act(() => result.current.setPlace("trash"));
    rerender(input({ urlPlace: "trash" }));
    expect(result.current.place).toBe("trash");
    expect(window.localStorage.getItem(`moduo:tasks:lastBucket:${WS}`)).toBe("b1");
  });

  it("doesn't reopen a passing place from the address bar on arrival", () => {
    window.localStorage.setItem(`moduo:tasks:lastBucket:${WS}`, "b1");
    const writes: string[] = [];
    const { result } = renderHook(() =>
      usePlanPlace(input({ urlPlace: "trash", onUrlPlaceChange: (p) => writes.push(p) })),
    );
    expect(result.current.place).toBe("b1");
    expect(writes).toEqual(["b1"]);
  });
});
