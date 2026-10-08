// F2-5: capture during a run adds to my queue by default.

import { describe, expect, it, rs } from "@rstest/core";

import { captureQueuesByDefault, routeCapture } from "./capture-route";

describe("where a capture lands (F2-5)", () => {
  it("defaults to my queue during a run here and in the Queue", () => {
    expect(captureQueuesByDefault(true, "inbox")).toBe(true);
    expect(captureQueuesByDefault(false, "today")).toBe(true);
    expect(captureQueuesByDefault(false, "inbox")).toBe(false);
  });

  it("goes into my queue when the switch is on, else it's a plain create", () => {
    const api = { captureToQueue: rs.fn(), createTask: rs.fn(async () => null) };
    const fields = { bucketId: "b1", title: "Call Ola" };
    routeCapture(api, fields, { queue: true });
    expect(api.captureToQueue).toHaveBeenCalledWith(fields);
    expect(api.createTask).not.toHaveBeenCalled();
    routeCapture(api, fields, { queue: false });
    expect(api.createTask).toHaveBeenCalledWith(fields);
  });
});
