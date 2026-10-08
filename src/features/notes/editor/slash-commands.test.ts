import { describe, expect, it } from "@rstest/core";
import { filterSlashCommands, SLASH_COMMANDS } from "./slash-commands";

describe("slash grammar (AC5 — the ratified final set)", () => {
  it("offers exactly the DESIGN_BRIEF §3c set", () => {
    expect(SLASH_COMMANDS.map((c) => c.id)).toEqual([
      "text",
      "h1",
      "h2",
      "h3",
      "bullet",
      "number",
      "todo",
      "quote",
      "code",
      "divider",
      "table",
      "page",
      "note",
      "task",
      "contact",
      "company",
      "event",
      "mindmap",
    ]);
  });

  it("dead commands are gone: /toggle and /embed-task", () => {
    const ids = SLASH_COMMANDS.map((c) => c.id) as string[];
    expect(ids).not.toContain("toggle");
    expect(ids).not.toContain("embed-task");
    expect(ids).not.toContain("embed-mindmap"); // renamed to /mindmap
    expect(filterSlashCommands("toggle")).toHaveLength(0);
  });

  it("mindmap is demoted to the last group", () => {
    expect(SLASH_COMMANDS[SLASH_COMMANDS.length - 1]!.id).toBe("mindmap");
    expect(SLASH_COMMANDS.at(-1)!.group).toBe("Embeds");
  });

  it("aliases keep discovery forgiving (child/subpage → page, check → todo)", () => {
    expect(filterSlashCommands("child")[0]!.id).toBe("page");
    expect(filterSlashCommands("subpage")[0]!.id).toBe("page");
    expect(filterSlashCommands("check")[0]!.id).toBe("todo");
    expect(filterSlashCommands("checkbox")[0]!.id).toBe("todo");
    expect(filterSlashCommands("person")[0]!.id).toBe("contact");
    expect(filterSlashCommands("hr")[0]!.id).toBe("divider");
  });

  it("title-prefix matches outrank keyword matches", () => {
    // "ta" prefixes Table and Task; "table" also keyword-matches nothing odd
    const ids = filterSlashCommands("ta").map((c) => c.id);
    expect(ids[0]).toBe("table");
    expect(ids).toContain("task");
  });

  it("empty query returns the full menu in registry order", () => {
    expect(filterSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("no match → empty (the menu closes, the caller types on)", () => {
    expect(filterSlashCommands("zzzz")).toHaveLength(0);
  });
});
