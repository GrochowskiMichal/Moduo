import { describe, expect, it } from "vitest";
import {
  BLOCK_REGISTRY,
  getRegistryEntry,
  isDraggable,
  canConvert,
  getConvertibleCommands,
  getMenuActions,
  isCodeBlockShellDomTarget,
  isInsideCodeBlock,
  resolveRegistryKey,
} from "./BlockRegistry";

const MOCK_COMMANDS = [
  { id: "paragraph", title: "Paragraph" },
  { id: "h1", title: "Heading 1" },
  { id: "h2", title: "Heading 2" },
  { id: "h3", title: "Heading 3" },
  { id: "bullet", title: "Bulleted List" },
  { id: "number", title: "Numbered List" },
  { id: "todo", title: "To-do List" },
  { id: "quote", title: "Quote" },
  { id: "code", title: "Code Block" },
  { id: "divider", title: "Divider" },
  { id: "toggle", title: "Toggle" },
  { id: "table", title: "Table" },
];

describe("BlockRegistry", () => {
  it("has entries for all core block types", () => {
    expect(BLOCK_REGISTRY.paragraph).toBeDefined();
    expect(BLOCK_REGISTRY.heading).toBeDefined();
    expect(BLOCK_REGISTRY["listitem-bullet"]).toBeDefined();
    expect(BLOCK_REGISTRY["listitem-number"]).toBeDefined();
    expect(BLOCK_REGISTRY["listitem-todo"]).toBeDefined();
    expect(BLOCK_REGISTRY.quote).toBeDefined();
    expect(BLOCK_REGISTRY.code).toBeDefined();
    expect(BLOCK_REGISTRY.toggle).toBeDefined();
    expect(BLOCK_REGISTRY.divider).toBeDefined();
    expect(BLOCK_REGISTRY.table).toBeDefined();
  });

  it("matches every PRD registry row", () => {
    const expected = [
      ["paragraph", "self", ["h1", "h2", "h3", "bullet", "number", "todo", "quote", "code", "toggle"], true],
      ["h1", "self", ["paragraph", "h2", "h3", "bullet", "number", "quote"], true],
      ["h2", "self", ["paragraph", "h1", "h3", "bullet", "number", "quote"], true],
      ["h3", "self", ["paragraph", "h1", "h2", "bullet", "number", "quote"], true],
      ["listitem-bullet", "list-item", ["paragraph", "number", "todo", "quote"], true],
      ["listitem-number", "list-item", ["paragraph", "bullet", "todo", "quote"], true],
      ["listitem-todo", "list-item", ["paragraph", "bullet", "number", "quote"], true],
      ["quote", "self", ["paragraph", "bullet", "number"], true],
      ["code", "self", ["paragraph"], false],
      ["toggle", "toggle-subtree", ["paragraph", "h1", "h2", "h3"], true],
      ["divider", "self", [], false],
      ["table", "whole-table", [], false],
    ] as const;

    for (const [key, unit, convertibleTo, turnInto] of expected) {
      expect(BLOCK_REGISTRY[key]).toMatchObject({
        draggableUnit: unit,
        convertibleTo,
        menuActions: expect.objectContaining({ turnInto }),
      });
    }
  });

  describe("resolveRegistryKey", () => {
    it("resolves bare listitem to bullet by default", () => {
      expect(resolveRegistryKey("listitem")).toBe("listitem-bullet");
    });

    it("resolves listitem with number listType", () => {
      expect(resolveRegistryKey("listitem", { listType: "number" })).toBe("listitem-number");
    });

    it("resolves listitem with check listType", () => {
      expect(resolveRegistryKey("listitem", { listType: "check" })).toBe("listitem-todo");
    });

    it("passes through non-listitem types", () => {
      expect(resolveRegistryKey("paragraph")).toBe("paragraph");
      expect(resolveRegistryKey("heading")).toBe("heading");
    });
  });

  describe("getRegistryEntry", () => {
    it("resolves paragraph", () => {
      const entry = getRegistryEntry("paragraph");
      expect(entry?.type).toBe("paragraph");
      expect(entry?.draggableUnit).toBe("self");
    });

    it("resolves heading", () => {
      const entry = getRegistryEntry("heading");
      expect(entry?.type).toBe("heading");
      expect(entry?.convertibleTo).toContain("paragraph");
    });

    it("resolves bare listitem to bullet variant", () => {
      const entry = getRegistryEntry("listitem");
      expect(entry?.type).toBe("listitem-bullet");
      expect(entry?.draggableUnit).toBe("list-item");
    });

    it("resolves listitem-bullet directly", () => {
      const entry = getRegistryEntry("listitem-bullet");
      expect(entry?.type).toBe("listitem-bullet");
    });

    it("resolves listitem-number directly", () => {
      const entry = getRegistryEntry("listitem-number");
      expect(entry?.type).toBe("listitem-number");
      expect(entry?.convertibleTo).toContain("paragraph");
      expect(entry?.convertibleTo).toContain("bullet");
    });

    it("resolves listitem-todo directly", () => {
      const entry = getRegistryEntry("listitem-todo");
      expect(entry?.type).toBe("listitem-todo");
      expect(entry?.convertibleTo).toContain("paragraph");
      expect(entry?.convertibleTo).toContain("number");
    });

    it("returns undefined for unknown type", () => {
      expect(getRegistryEntry("unknown")).toBeUndefined();
    });
  });

  describe("isDraggable", () => {
    it("paragraph is draggable", () => {
      expect(isDraggable("paragraph")).toBe(true);
    });

    it("toggle is draggable", () => {
      expect(isDraggable("toggle")).toBe(true);
    });

    it("code is draggable", () => {
      expect(isDraggable("code")).toBe(true);
    });

    it("listitem is draggable via backwards compat", () => {
      expect(isDraggable("listitem")).toBe(true);
    });
  });

  describe("canConvert", () => {
    it("paragraph can convert", () => {
      expect(canConvert("paragraph")).toBe(true);
    });

    it("divider cannot convert", () => {
      expect(canConvert("divider")).toBe(false);
    });

    it("table cannot convert", () => {
      expect(canConvert("table")).toBe(false);
    });
  });

  describe("getConvertibleCommands", () => {
    it("returns correct commands for paragraph", () => {
      const commands = getConvertibleCommands("paragraph", MOCK_COMMANDS);
      const ids = commands.map((c) => c.id);
      expect(ids).toContain("h1");
      expect(ids).toContain("bullet");
      expect(ids).toContain("toggle");
      expect(ids).not.toContain("divider");
    });

    it("returns empty for divider", () => {
      const commands = getConvertibleCommands("divider", MOCK_COMMANDS);
      expect(commands).toHaveLength(0);
    });

    it("returns empty for table", () => {
      const commands = getConvertibleCommands("table", MOCK_COMMANDS);
      expect(commands).toHaveLength(0);
    });

    it("bullet listitem can convert to paragraph, number, todo, quote", () => {
      const commands = getConvertibleCommands("listitem-bullet", MOCK_COMMANDS);
      const ids = commands.map((c) => c.id);
      expect(ids).toContain("paragraph");
      expect(ids).toContain("number");
      expect(ids).toContain("todo");
      expect(ids).toContain("quote");
      expect(ids).not.toContain("code");
    });

    it("number listitem can convert to paragraph, bullet, todo, quote", () => {
      const commands = getConvertibleCommands("listitem-number", MOCK_COMMANDS);
      const ids = commands.map((c) => c.id);
      expect(ids).toContain("paragraph");
      expect(ids).toContain("bullet");
      expect(ids).toContain("todo");
      expect(ids).toContain("quote");
      expect(ids).not.toContain("code");
    });

    it("todo listitem can convert to paragraph, bullet, number, quote", () => {
      const commands = getConvertibleCommands("listitem-todo", MOCK_COMMANDS);
      const ids = commands.map((c) => c.id);
      expect(ids).toContain("paragraph");
      expect(ids).toContain("bullet");
      expect(ids).toContain("number");
      expect(ids).toContain("quote");
      expect(ids).not.toContain("code");
    });
  });

  describe("getMenuActions", () => {
    it("paragraph has full menu", () => {
      const actions = getMenuActions("paragraph");
      expect(actions.turnInto).toBe(true);
      expect(actions.duplicate).toBe(true);
      expect(actions.delete).toBe(true);
    });

    it("divider has no turnInto", () => {
      const actions = getMenuActions("divider");
      expect(actions.turnInto).toBe(false);
      expect(actions.duplicate).toBe(true);
    });

    it("table has no turnInto", () => {
      const actions = getMenuActions("table");
      expect(actions.turnInto).toBe(false);
    });
  });

  describe("isInsideCodeBlock", () => {
    it("returns false for null", () => {
      expect(isInsideCodeBlock(null)).toBe(false);
    });
  });

  describe("isCodeBlockShellDomTarget", () => {
    it("returns false for null target", () => {
      expect(isCodeBlockShellDomTarget(null, document.createElement("div"))).toBe(false);
    });

    it("returns false for null shell", () => {
      expect(isCodeBlockShellDomTarget(document.createElement("span"), null)).toBe(false);
    });

    it("returns true when target is the shell element itself", () => {
      const shell = document.createElement("code");
      expect(isCodeBlockShellDomTarget(shell, shell)).toBe(true);
    });

    it("returns false when target is a descendant text span inside the shell", () => {
      const shell = document.createElement("code");
      const text = document.createElement("span");
      shell.appendChild(text);
      expect(isCodeBlockShellDomTarget(text, shell)).toBe(false);
    });
  });
});
