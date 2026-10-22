import { describe, expect, it } from "@rstest/core";

import type { Note } from "../model";
import { buildBreadcrumb } from "./breadcrumb";

function note(partial: Partial<Note> & { id: string }): Note {
  return {
    workspaceId: "ws1",
    createdBy: "u1",
    parentId: null,
    title: partial.id,
    icon: null,
    isPinned: false,
    position: "0000001000",
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: false,
    fullWidth: false,
    ...partial,
  };
}

const labels = (crumbs: ReturnType<typeof buildBreadcrumb>) => crumbs.map((c) => c.label);

describe("crumbs — the note breadcrumb (NR-2, AC5)", () => {
  const notes = [
    note({ id: "clients", title: "Clients" }),
    note({ id: "acme", title: "Acme", parentId: "clients" }),
    note({ id: "kickoff", title: "Kickoff", parentId: "acme" }),
    note({ id: "idea", title: "Idea", inInbox: true }),
    note({ id: "ideaKid", title: "Detail", parentId: "idea" }),
    note({ id: "old", title: "Old", isArchived: true }),
    note({ id: "gone", title: "Gone", deletedAt: "2026-10-12T00:00:00.000Z" }),
  ];

  it("walks a page's ancestors under Pages, current note last", () => {
    const crumbs = buildBreadcrumb(notes, "kickoff");
    expect(labels(crumbs)).toEqual(["Pages", "Clients", "Acme", "Kickoff"]);
    expect(crumbs.at(-1)).toMatchObject({ kind: "note", id: "kickoff", current: true });
    expect(crumbs[1]).toMatchObject({ kind: "note", id: "clients", current: false });
  });

  it("shows Inbox for an Inbox note and for a note nested under one", () => {
    expect(labels(buildBreadcrumb(notes, "idea"))).toEqual(["Inbox", "Idea"]);
    expect(labels(buildBreadcrumb(notes, "ideaKid"))).toEqual(["Inbox", "Idea", "Detail"]);
  });

  it("starts archived and trashed notes at Archive / Trash", () => {
    expect(labels(buildBreadcrumb(notes, "old"))).toEqual(["Archive", "Old"]);
    expect(labels(buildBreadcrumb(notes, "gone"))).toEqual(["Trash", "Gone"]);
  });

  it("shows a root draft as an Untitled Inbox capture, and a child draft under its page", () => {
    expect(labels(buildBreadcrumb(notes, "d1", { id: "d1", parentId: null }))).toEqual([
      "Inbox",
      "Untitled",
    ]);
    expect(labels(buildBreadcrumb(notes, "d2", { id: "d2", parentId: "acme" }))).toEqual([
      "Pages",
      "Clients",
      "Acme",
      "Untitled",
    ]);
  });

  it("returns nothing for an unknown note", () => {
    expect(buildBreadcrumb(notes, "nope")).toEqual([]);
  });
});
