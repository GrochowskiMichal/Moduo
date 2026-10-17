import { describe, expect, it, rs } from "@rstest/core";

import {
  consumeFocusViewRequest,
  FOCUS_VIEW_REQUEST_EVENT,
  requestFocusView,
} from "./view-request";

describe("chip → open Focus request (DF-11)", () => {
  it("sets a one-shot flag consumed once", () => {
    expect(consumeFocusViewRequest()).toBe(false);
    requestFocusView();
    expect(consumeFocusViewRequest()).toBe(true);
    expect(consumeFocusViewRequest()).toBe(false);
  });

  it("dispatches the window event for an already-mounted /tasks", () => {
    const handler = rs.fn();
    window.addEventListener(FOCUS_VIEW_REQUEST_EVENT, handler);
    requestFocusView();
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(FOCUS_VIEW_REQUEST_EVENT, handler);
    consumeFocusViewRequest();
  });
});
