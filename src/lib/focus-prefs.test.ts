import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";

import { DEFAULT_FOCUS_PREFS, useFocusPrefs } from "./focus-prefs";

// The shared value lives in a module-level store outside React, so clearing the
// localStorage mirror alone wouldn't reset it between tests. Render one instance
// and reset() through the public hook — that's the only way in.
beforeEach(() => {
  localStorage.clear();
  const { result, unmount } = renderHook(() => useFocusPrefs());
  act(() => result.current.reset());
  unmount();
});

afterEach(() => {
  cleanup();
});

describe("useFocusPrefs", () => {
  it("propagates a write from one instance to every other mounted instance", () => {
    // The bug this guards: Settings → Focus and the Execute timer each held a
    // private useState copy, so editing intervals in Settings never reached the
    // already-mounted timer until it remounted.
    const settings = renderHook(() => useFocusPrefs());
    const timer = renderHook(() => useFocusPrefs());

    act(() => settings.result.current.setPrefs({ workMinutes: 50 }));

    expect(timer.result.current.prefs.workMinutes).toBe(50);
    expect(settings.result.current.prefs.workMinutes).toBe(50);
  });

  it("sanitizes and clamps writes to the 1–180 minute range", () => {
    const { result } = renderHook(() => useFocusPrefs());

    act(() => result.current.setPrefs({ workMinutes: 9999 }));
    expect(result.current.prefs.workMinutes).toBe(180);

    act(() => result.current.setPrefs({ breakMinutes: 0 }));
    expect(result.current.prefs.breakMinutes).toBe(1);
  });

  it("reset restores defaults across every instance", () => {
    const a = renderHook(() => useFocusPrefs());
    const b = renderHook(() => useFocusPrefs());

    act(() => a.result.current.setPrefs({ breakMinutes: 12 }));
    expect(b.result.current.prefs.breakMinutes).toBe(12);

    act(() => a.result.current.reset());
    expect(b.result.current.prefs.breakMinutes).toBe(DEFAULT_FOCUS_PREFS.breakMinutes);
  });

  it("mirrors writes to localStorage for an instant first paint on the next mount", () => {
    const { result } = renderHook(() => useFocusPrefs());

    act(() => result.current.setPrefs({ longBreakMinutes: 20 }));

    const mirror = localStorage.getItem("moduo.focus");
    expect(mirror).not.toBeNull();
    expect(JSON.parse(mirror as string).longBreakMinutes).toBe(20);
  });
});
