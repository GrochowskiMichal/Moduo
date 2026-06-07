import { describe, expect, it } from "vitest";
import {
  areContiguousSiblings,
  decideSiblingDrop,
  resolveDropPlacement,
  shouldExposeSlashLikeControls,
  uniqueKeys,
  validateDropZone,
  getDraggableUnit,
  shouldConvertListDragToParagraph,
  isListType,
} from "./BlockControlsModel";

describe("notes block controls model", () => {
  it("deduplicates selected keys while preserving order", () => {
    expect(uniqueKeys(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("detects contiguous sibling selections", () => {
    expect(areContiguousSiblings(["b", "c"], ["a", "b", "c", "d"])).toBe(true);
    expect(areContiguousSiblings(["b", "d"], ["a", "b", "c", "d"])).toBe(false);
    expect(areContiguousSiblings(["x"], ["a", "b", "c"])).toBe(false);
  });

  it("resolves drop placement from the target midpoint", () => {
    expect(resolveDropPlacement(124, 100, 50)).toBe("before");
    expect(resolveDropPlacement(126, 100, 50)).toBe("after");
  });

  it("rejects invalid sibling drops", () => {
    expect(
      decideSiblingDrop({ selectedKeys: [], targetKey: "a", siblingOrder: ["a"], sameParent: true }),
    ).toEqual({ allowed: false, reason: "empty-selection" });
    expect(
      decideSiblingDrop({ selectedKeys: ["a"], targetKey: "a", siblingOrder: ["a"], sameParent: true }),
    ).toEqual({ allowed: false, reason: "target-inside-selection" });
    expect(
      decideSiblingDrop({
        selectedKeys: ["a"],
        targetKey: "b",
        siblingOrder: ["a", "b"],
        sameParent: false,
      }),
    ).toEqual({ allowed: false, reason: "different-parent" });
    expect(
      decideSiblingDrop({
        selectedKeys: ["a", "c"],
        targetKey: "d",
        siblingOrder: ["a", "b", "c", "d"],
        sameParent: true,
      }),
    ).toEqual({ allowed: false, reason: "not-contiguous" });
  });

  it("allows valid contiguous sibling drops", () => {
    expect(
      decideSiblingDrop({
        selectedKeys: ["b", "c"],
        targetKey: "d",
        siblingOrder: ["a", "b", "c", "d"],
        sameParent: true,
      }),
    ).toEqual({ allowed: true });
  });

  it("hides slash-like controls in code and table internals", () => {
    expect(shouldExposeSlashLikeControls("paragraph")).toBe(true);
    expect(shouldExposeSlashLikeControls("code")).toBe(false);
    expect(shouldExposeSlashLikeControls("tablecell")).toBe(false);
  });

  describe("validateDropZone", () => {
    it("rejects drops into code block interior", () => {
      expect(
        validateDropZone({
          draggedType: "paragraph",
          targetType: "code",
          targetParentType: null,
          isTopLevel: true,
        }),
      ).toEqual({ valid: false });
    });

    it("rejects drops into table cells", () => {
      expect(
        validateDropZone({
          draggedType: "paragraph",
          targetType: "tablecell",
          targetParentType: "tablerow",
          isTopLevel: true,
        }),
      ).toEqual({ valid: false });
    });

    it("allows valid top-level drops", () => {
      expect(
        validateDropZone({
          draggedType: "paragraph",
          targetType: "paragraph",
          targetParentType: "root",
          isTopLevel: true,
        }),
      ).toEqual({ valid: true });
    });

    it("rejects toggle drop into non-top-level", () => {
      expect(
        validateDropZone({
          draggedType: "toggle",
          targetType: "paragraph",
          targetParentType: "toggle",
          isTopLevel: false,
        }),
      ).toEqual({ valid: false });
    });

    it("allows toggle drop at top-level", () => {
      expect(
        validateDropZone({
          draggedType: "toggle",
          targetType: "paragraph",
          targetParentType: "root",
          isTopLevel: true,
        }),
      ).toEqual({ valid: true });
    });

    it("flags list item drop to top-level as convert to paragraph", () => {
      expect(
        validateDropZone({
          draggedType: "listitem",
          targetType: "paragraph",
          targetParentType: "root",
          isTopLevel: true,
        }),
      ).toEqual({ valid: true, convertToParagraph: true });
    });
  });

  describe("getDraggableUnit", () => {
    it("returns self for paragraph", () => {
      expect(getDraggableUnit("paragraph")).toBe("self");
    });

    it("returns list-item for listitem", () => {
      expect(getDraggableUnit("listitem")).toBe("list-item");
    });

    it("returns toggle-subtree for toggle", () => {
      expect(getDraggableUnit("toggle")).toBe("toggle-subtree");
    });

    it("returns whole-table for table", () => {
      expect(getDraggableUnit("table")).toBe("whole-table");
    });

    it("returns none for code", () => {
      expect(getDraggableUnit("code")).toBe("self");
    });
  });

  describe("shouldConvertListDragToParagraph", () => {
    it("converts listitem dropping to top-level", () => {
      expect(shouldConvertListDragToParagraph("listitem", true)).toBe(true);
    });

    it("does not convert listitem staying in list", () => {
      expect(shouldConvertListDragToParagraph("listitem", false)).toBe(false);
    });
  });

  describe("isListType", () => {
    it("identifies list types", () => {
      expect(isListType("listitem")).toBe(true);
      expect(isListType("bullet")).toBe(true);
      expect(isListType("number")).toBe(true);
      expect(isListType("todo")).toBe(true);
      expect(isListType("paragraph")).toBe(false);
    });
  });
});
