// TV-U1 — the Tasks Display value (Completed + "Show on rows"), as stored per
// workspace and scope. TV-U2 extends this file with group, order and subtasks.

import { describe, expect, it } from "@rstest/core";
import {
  sanitizeTasksDisplay,
  TASKS_DISPLAY_DEFAULTS,
  tasksDisplayControls,
  tasksDisplayKey,
} from "./display";

describe("Tasks Display", () => {
  it("defaults to completed hidden and energy off on rows", () => {
    expect(TASKS_DISPLAY_DEFAULTS.completed).toBe("hidden");
    expect(TASKS_DISPLAY_DEFAULTS.properties).toEqual(["priority", "date", "assignee"]);
  });

  it("keeps a stored choice it still offers", () => {
    const stored = { completed: "week", properties: ["energy", "priority"] };
    expect(sanitizeTasksDisplay(stored, TASKS_DISPLAY_DEFAULTS)).toEqual({
      completed: "week",
      // Toggles come back in the menu's order.
      properties: ["priority", "energy"],
    });
  });

  it("falls back to the defaults for anything it doesn't know", () => {
    const stored = { completed: "forever", properties: ["priority", "mood"] };
    expect(sanitizeTasksDisplay(stored, TASKS_DISPLAY_DEFAULTS)).toEqual({
      completed: "hidden",
      properties: ["priority"],
    });
    expect(sanitizeTasksDisplay("junk", TASKS_DISPLAY_DEFAULTS)).toEqual(TASKS_DISPLAY_DEFAULTS);
  });

  it("the Queue offers no Completed choice (done leaves the queue)", () => {
    expect(tasksDisplayControls("today").map((c) => c.id)).toEqual(["properties"]);
    expect(tasksDisplayControls("inbox").map((c) => c.id)).toEqual(["completed", "properties"]);
  });

  it("is remembered per workspace and scope", () => {
    expect(tasksDisplayKey("w1", "inbox")).toBe("moduo:tasks:view:w1:inbox");
    expect(tasksDisplayKey("w1", "b-42")).toBe("moduo:tasks:view:w1:b-42");
    expect(tasksDisplayKey("", "inbox")).toBeNull();
  });
});
