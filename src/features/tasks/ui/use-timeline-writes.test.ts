// ⌥←/→ and ⇧D on a mixed selection move only the tasks you can edit; the
// toast says how many stayed put, and why.

import { describe, expect, it } from "@rstest/core";

import { withSkipped } from "./use-timeline-writes";

describe("withSkipped", () => {
  it("adds the ones left where they are", () => {
    expect(withSkipped("Moved 3 tasks a day later", 2)).toBe(
      "Moved 3 tasks a day later · 2 not yours to move",
    );
    expect(withSkipped("Due date cleared", 1)).toBe("Due date cleared · 1 not yours to move");
  });

  it("says nothing extra when every task moved", () => {
    expect(withSkipped("Moved 3 tasks a day later", 0)).toBe("Moved 3 tasks a day later");
  });
});
