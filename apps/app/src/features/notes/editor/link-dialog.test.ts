import { describe, expect, it } from "@rstest/core";

import type { Note } from "../model";
import { linkDialogRows, linkUrlFrom } from "./link-dialog";

const note = (id: string, title: string) =>
  ({ id, title, deletedAt: null, isArchived: false, updatedAt: "2026-10-01T00:00:00Z" }) as Note;

describe("⌘K link dialog", () => {
  it("reads URLs, adds https to a bare domain, refuses unsafe schemes and bare words", () => {
    expect(linkUrlFrom("https://moduo.app/x")).toBe("https://moduo.app/x");
    expect(linkUrlFrom("moduo.app/pricing")).toBe("https://moduo.app/pricing");
    expect(linkUrlFrom("mailto:hi@moduo.app")).toBe("mailto:hi@moduo.app");
    expect(linkUrlFrom("javascript:alert(1)")).toBeNull();
    expect(linkUrlFrom("data:text/html,x")).toBeNull();
    expect(linkUrlFrom("roadmap")).toBeNull();
    expect(linkUrlFrom("two words")).toBeNull();
    expect(linkUrlFrom("")).toBeNull();
  });

  it("offers the URL first, then notes, then Remove link", () => {
    const notes = [note("1", "Roadmap"), note("2", "roadmap.md notes")];
    expect(linkDialogRows("roadmap", notes, null, false)).toEqual([
      { kind: "note", id: "1", title: "Roadmap" },
      { kind: "note", id: "2", title: "roadmap.md notes" },
    ]);
    expect(linkDialogRows("roadmap.md", notes, null, true)).toEqual([
      { kind: "url", url: "https://roadmap.md" },
      { kind: "note", id: "2", title: "roadmap.md notes" },
      { kind: "unlink" },
    ]);
  });
});
