// `useReducedMotion()`: Settings' motion choice (`data-motion` on <html>) wins
// over the OS setting, and a change in Settings reaches an open page at once.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useReducedMotion } from "./use-reduced-motion";

function mockOsReduce(matches: boolean) {
  rs.stubGlobal(
    "matchMedia",
    rs.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: rs.fn(),
      removeEventListener: rs.fn(),
    })),
  );
}

afterEach(() => {
  document.documentElement.removeAttribute("data-motion");
  rs.unstubAllGlobals();
});

describe("useReducedMotion", () => {
  it("follows the OS when Settings says System", () => {
    mockOsReduce(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
    mockOsReduce(false);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });

  it("lets Settings override the OS both ways", () => {
    mockOsReduce(false);
    document.documentElement.setAttribute("data-motion", "reduced");
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);

    mockOsReduce(true);
    document.documentElement.setAttribute("data-motion", "full");
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });

  it("updates an open page when Settings changes", async () => {
    mockOsReduce(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => document.documentElement.setAttribute("data-motion", "reduced"));
    await waitFor(() => expect(result.current).toBe(true));
    act(() => document.documentElement.setAttribute("data-motion", "system"));
    await waitFor(() => expect(result.current).toBe(false));
  });
});
