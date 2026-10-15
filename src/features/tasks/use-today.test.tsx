// `useToday(zone)` (MOD-110): the saved zone's day, which turns over at that
// zone's midnight while the page stays open, and follows a zone changed in
// Settings at once.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import { useToday } from "./use-today";

describe("useToday with a zone", () => {
  it("turns over at the zone's midnight, not the device's", () => {
    rs.useFakeTimers();
    try {
      // 23:59:30 on Nov 1 in Auckland (UTC+13).
      rs.setSystemTime(new Date("2026-11-01T10:59:30.000Z"));
      const { result } = renderHook(() => useToday("Pacific/Auckland"));
      expect(result.current).toBe("2026-11-01");
      act(() => {
        rs.setSystemTime(new Date("2026-11-01T11:00:01.000Z"));
        rs.advanceTimersByTime(31_000);
      });
      expect(result.current).toBe("2026-11-02");
    } finally {
      rs.useRealTimers();
    }
  });

  it("reads the new zone's day as soon as the zone changes", () => {
    rs.useFakeTimers();
    try {
      rs.setSystemTime(new Date("2026-11-01T11:30:00.000Z"));
      const { result, rerender } = renderHook(({ zone }) => useToday(zone), {
        initialProps: { zone: "Pacific/Auckland" },
      });
      expect(result.current).toBe("2026-11-02");
      rerender({ zone: "America/Los_Angeles" });
      expect(result.current).toBe("2026-11-01");
    } finally {
      rs.useRealTimers();
    }
  });
});
