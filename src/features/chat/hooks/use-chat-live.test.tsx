import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChatOnline, useChatTyping } from "./use-chat-live";

describe("chat live hooks before the realtime link exists", () => {
  // Regression: an inline `() => []` snapshot made the Chat page loop forever
  // (React #185) on every load, before the link connected.
  it("render without looping and return the same empty values each render", () => {
    const { result, rerender } = renderHook(() => ({
      online: useChatOnline(null),
      typing: useChatTyping(null),
    }));
    const first = result.current;
    rerender();
    expect(result.current.online).toBe(first.online);
    expect(result.current.typing).toBe(first.typing);
    expect(result.current.typing).toEqual([]);
    expect(result.current.online.size).toBe(0);
  });
});
