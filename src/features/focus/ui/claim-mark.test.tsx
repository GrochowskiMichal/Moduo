// "<name> is on this" in the detail panel's header (TV-F6): who, and nothing
// else about their session; nothing at all when nobody is on the task.
import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { setRunClaims } from "../claims";
import { TaskClaimMark } from "./claim-mark";

afterEach(() => {
  cleanup();
  act(() => setRunClaims(null, new Map()));
});

function renderMark(taskId = "t1") {
  render(
    <TooltipProvider>
      <TaskClaimMark workspaceId="w1" taskId={taskId} />
    </TooltipProvider>,
  );
}

describe("TaskClaimMark", () => {
  it("draws nothing while nobody is on the task", () => {
    renderMark();
    expect(document.querySelector('[data-slot="claim-mark"]')).toBeNull();
  });

  it("says who is on it, and only for that task and workspace", () => {
    act(() => setRunClaims("w1", new Map([["t1", ["mike", "ola"]]])));
    renderMark();
    // Without the workspace provider the names read "Someone".
    expect(screen.getByRole("img", { name: "Someone and Someone are on this" })).not.toBeNull();
    cleanup();
    renderMark("t2");
    expect(document.querySelector('[data-slot="claim-mark"]')).toBeNull();
    cleanup();
    act(() => setRunClaims("w2", new Map([["t1", ["mike"]]])));
    renderMark();
    expect(document.querySelector('[data-slot="claim-mark"]')).toBeNull();
  });
});
