import { describe, expect, it } from "vitest";
import { resolveToggleTitleEnterAction } from "./TogglePlugins";

describe("toggle title enter behavior", () => {
  it("removes an empty toggle title", () => {
    expect(resolveToggleTitleEnterAction({ titleText: "", isOpen: true })).toBe("remove");
    expect(resolveToggleTitleEnterAction({ titleText: "   ", isOpen: false })).toBe("remove");
  });

  it("creates toggle body content from an open titled toggle", () => {
    expect(resolveToggleTitleEnterAction({ titleText: "Project notes", isOpen: true })).toBe("body");
  });

  it("creates a sibling toggle from a closed titled toggle", () => {
    expect(resolveToggleTitleEnterAction({ titleText: "Project notes", isOpen: false })).toBe("sibling");
  });
});
