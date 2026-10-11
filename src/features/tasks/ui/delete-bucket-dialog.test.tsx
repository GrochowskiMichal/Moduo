// TV-U6 — the project confirms (REPLAN 78): Delete project… says where the
// open work goes and that the finished work goes with it (no "Move to Inbox /
// Delete the tasks too" choice any more); Archive… asks "4 open tasks — Won't
// do · Move · Keep"; both check Full access first and say so without it.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Bucket } from "../model";
import {
  ArchiveProjectDialog,
  DeleteBucketDialog,
  projectDeleteLines,
} from "./delete-bucket-dialog";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const NOW = "2026-10-01T00:00:00.000Z";
const project = (id: string, name: string): Bucket => ({
  id,
  workspaceId: "w",
  ownerId: "u",
  name,
  isSystem: false,
  group: null,
  position: id,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});
const ACME = project("acme", "Acme rebrand");
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

describe("projectDeleteLines (REPLAN 78)", () => {
  it("says where the open work goes", () => {
    expect(projectDeleteLines({ moving: 4, toYou: 2, finished: 0 })).toEqual([
      "Its 4 open tasks go to their assignees’ Inboxes (2 tasks to yours).",
    ]);
    expect(projectDeleteLines({ moving: 3, toYou: 3, finished: 0 })).toEqual([
      "Its 3 open tasks go to your Inbox.",
    ]);
    expect(projectDeleteLines({ moving: 1, toYou: 0, finished: 0 })).toEqual([
      "Its open task goes to its assignee’s Inbox.",
    ]);
  });

  it("says the finished work goes with the project", () => {
    expect(projectDeleteLines({ moving: 0, toYou: 0, finished: 12 })).toEqual([
      "Its 12 finished tasks go with it to Recently deleted.",
    ]);
    expect(projectDeleteLines({ moving: 0, toYou: 0, finished: 0 })).toEqual(["It has no tasks."]);
  });
});

describe("DeleteBucketDialog", () => {
  it("names the project, says what happens, and deletes only on the destructive button", async () => {
    const onConfirm = rs.fn();
    const onClose = rs.fn();
    render(
      <DeleteBucketDialog
        bucket={ACME}
        open
        summary={{ moving: 4, toYou: 1, finished: 2 }}
        checkAccess={async () => true}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    await settle();
    expect(screen.getByRole("dialog", { name: "Delete “Acme rebrand”?" })).toBeTruthy();
    expect(screen.getByText(/Its 4 open tasks go to their assignees’ Inboxes/)).toBeTruthy();
    expect(screen.getByText(/Its 2 finished tasks go with it to Recently deleted/)).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/bucket/i);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onConfirm).toHaveBeenCalledWith(ACME);
    expect(onClose).toHaveBeenCalled();
  });

  it("says so, with no delete button, without full access", async () => {
    render(
      <DeleteBucketDialog
        bucket={ACME}
        open
        summary={{ moving: 1, toYou: 1, finished: 0 }}
        checkAccess={async () => false}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    await settle();
    expect(
      screen.getByText("Only people with full access to “Acme rebrand” can delete it."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete project" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("stays closed without a project", () => {
    render(
      <DeleteBucketDialog
        bucket={null}
        open
        summary={{ moving: 0, toYou: 0, finished: 0 }}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ArchiveProjectDialog", () => {
  const renderArchive = (canManage = true) => {
    const onConfirm = rs.fn();
    render(
      <ArchiveProjectDialog
        bucket={ACME}
        open
        openCount={4}
        projects={[ACME, project("site", "Website")]}
        checkAccess={async () => canManage}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );
    return onConfirm;
  };

  it("asks “4 open tasks — Won’t do · Move · Keep”", async () => {
    const onConfirm = renderArchive();
    await settle();
    expect(screen.getByText("4 open tasks — Won’t do · Move · Keep")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Won’t do" }));
    expect(onConfirm).toHaveBeenCalledWith(ACME, { kind: "wont_do" });
  });

  it("Keep archives and leaves them open", async () => {
    const onConfirm = renderArchive();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onConfirm).toHaveBeenCalledWith(ACME, { kind: "keep" });
  });

  it("Move asks where to, among the other projects", async () => {
    const onConfirm = renderArchive();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Move…" }));
    await settle();
    const move = screen.getByRole("button", { name: "Move and archive" });
    expect(move.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: "Move them to" })).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("says so without full access", async () => {
    renderArchive(false);
    await settle();
    expect(
      screen.getByText("Only people with full access to “Acme rebrand” can archive it."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });
});
