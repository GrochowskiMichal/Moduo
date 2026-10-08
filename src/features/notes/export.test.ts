import { describe, expect, it } from "@rstest/core";
import { buildZipEntries, noteFileName, safeFileStem } from "./export";

describe("safeFileStem / noteFileName (AC11)", () => {
  it("removes path-hostile characters and adds .md", () => {
    const name = noteFileName('a/b:c*?"<>|');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
    expect(name.endsWith(".md")).toBe(true);
  });

  it("falls back to Untitled for a blank title", () => {
    expect(noteFileName("")).toBe("Untitled.md");
    expect(safeFileStem("   ")).toBe("Untitled");
  });
});

describe("buildZipEntries (AC11 tree export)", () => {
  it("nests notes under their ancestor folders", () => {
    const entries = buildZipEntries([
      { id: "1", title: "Clients", md: "# Clients", pathSegments: [] },
      { id: "2", title: "Acme", md: "# Acme", pathSegments: ["Clients"] },
    ]);
    const keys = Object.keys(entries);
    expect(keys).toContain("Clients.md");
    expect(keys).toContain("Clients/Acme.md");
  });

  it("de-dupes colliding sibling filenames", () => {
    const entries = buildZipEntries([
      { id: "1", title: "Note", md: "a", pathSegments: ["Dir"] },
      { id: "2", title: "Note", md: "b", pathSegments: ["Dir"] },
    ]);
    const keys = Object.keys(entries);
    expect(keys).toContain("Dir/Note.md");
    expect(keys).toContain("Dir/Note (2).md");
  });
});
