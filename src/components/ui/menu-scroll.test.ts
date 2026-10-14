// A menu that scrolls says so (TV-U10): `data-more-below` while items wait
// below the fold, gone once scrolled to the end.

import { describe, expect, it } from "@rstest/core";
import { hasMoreBelow, useMoreBelowRef } from "./menu-scroll";

function scroller(scrollHeight: number, clientHeight: number) {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  return el;
}

describe("a menu that scrolls", () => {
  it("has more below while its list runs past its room", () => {
    expect(hasMoreBelow({ scrollHeight: 800, clientHeight: 300, scrollTop: 0 })).toBe(true);
    expect(hasMoreBelow({ scrollHeight: 800, clientHeight: 300, scrollTop: 500 })).toBe(false);
    expect(hasMoreBelow({ scrollHeight: 300, clientHeight: 300, scrollTop: 0 })).toBe(false);
  });

  it("marks the node, and unmarks it scrolled to the end", async () => {
    // The ref callback outside React: the hooks only keep it stable.
    const { renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() => useMoreBelowRef<HTMLDivElement>());
    const el = scroller(800, 300);
    result.current(el);
    expect(el.hasAttribute("data-more-below")).toBe(true);
    el.scrollTop = 500;
    el.dispatchEvent(new Event("scroll"));
    expect(el.hasAttribute("data-more-below")).toBe(false);
    result.current(null);
  });

  it("passes the node on to the consumer's ref", async () => {
    const { renderHook } = await import("@testing-library/react");
    const mine = { current: null as HTMLDivElement | null };
    const { result } = renderHook(() => useMoreBelowRef<HTMLDivElement>(mine));
    const el = scroller(100, 100);
    result.current(el);
    expect(mine.current).toBe(el);
    expect(el.hasAttribute("data-more-below")).toBe(false);
  });
});
