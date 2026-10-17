// DS-4 — DROP_TARGET has to win over a row's own hover fill: the drag overlay
// takes no pointer events, so the target row is `:hover` for the whole drag.
import { describe, expect, it } from "@rstest/core";

import { cn } from "@/lib/utils";
import { DRAG_SOURCE, DROP_TARGET } from "./drag-visuals";

describe("drag visuals", () => {
  it("replaces a row's hover fill when composed after it with cn()", () => {
    const classes = cn("hover:bg-state-hover bg-transparent", DROP_TARGET).split(" ");
    expect(classes).not.toContain("hover:bg-state-hover");
    expect(classes).not.toContain("bg-transparent");
    expect(classes).toContain("hover:bg-state-active");
    expect(classes).toContain("bg-state-active");
  });

  it("composes the accent directly (R5), never the selection recipe", () => {
    expect(DROP_TARGET).toContain("ring-primary/60");
    expect(DROP_TARGET).not.toContain("state-selected");
    expect(DRAG_SOURCE).toBe("opacity-40");
  });
});
