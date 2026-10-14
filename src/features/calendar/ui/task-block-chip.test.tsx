// AT-3 (AT3-3): a task's block on the calendar carries the quiet 📎 mark,
// hidden at 0, and says it in the block's hover text.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { TaskBlockChip } from "./task-block-chip";

afterEach(cleanup);

function chip(files?: number) {
  render(
    <TooltipProvider>
      <TaskBlockChip
        title="Write the brief"
        startMs={Date.UTC(2026, 9, 14, 9)}
        endMs={Date.UTC(2026, 9, 14, 10)}
        done={false}
        compact={false}
        canEdit
        onToggleDone={() => {}}
        files={files}
      />
    </TooltipProvider>,
  );
  return document.querySelector("[data-task-block]") as HTMLElement;
}

describe("TaskBlockChip — the 📎 mark", () => {
  it("shows the file count, and names it in the hover text", () => {
    const el = chip(2);
    expect(screen.getByText("2 files").className).toContain("sr-only");
    expect(el.getAttribute("title")).toMatch(/· 2 files$/);
  });

  it("is hidden at 0", () => {
    const el = chip(0);
    expect(el.querySelector('[data-slot="meta-count"]')).toBeNull();
    expect(el.getAttribute("title")).not.toMatch(/file/);
  });
});
