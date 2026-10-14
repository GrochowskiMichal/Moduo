// DF-23 — the blur-commit must baseline against the SERIALIZED seed, so merely
// focusing then leaving a migrated (legacy plain-text) description does NOT fire
// a spurious write (updatedAt bump / phantom activity row). Regression guard for
// the senior-review finding.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EntityTextEditor } from "./entity-text-editor";

afterEach(cleanup);

describe("EntityTextEditor commit-on-blur", () => {
  it("does not commit when a legacy plain-text value is focused then left untouched", () => {
    const onCommit = rs.fn();
    render(
      <EntityTextEditor
        value="a legacy plain description"
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "task", id: "t-1" }}
        ariaLabel="Description"
        onCommit={onCommit}
      />,
    );
    const box = screen.getByLabelText("Description");
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("EntityTextEditor files (AT-2: attachments only, no image nodes)", () => {
  function clipboard(files: File[]) {
    return { types: ["Files"], files, items: [], getData: () => "" };
  }

  it("hands pasted files to onFiles instead of inserting them", async () => {
    const onFiles = rs.fn();
    render(
      <EntityTextEditor
        value=""
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "task", id: "t-1" }}
        ariaLabel="Description"
        onFiles={onFiles}
      />,
    );
    const box = screen.getByLabelText("Description");
    const shot = new File(["x"], "shot.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(paste, { clipboardData: clipboard([shot]) });
    // jsdom has neither event class; Lexical tells them apart by class name.
    class ClipboardEvent extends Event {}
    class DragEvent extends Event {}
    const g = globalThis as Record<string, unknown>;
    g.ClipboardEvent ??= ClipboardEvent;
    g.DragEvent ??= DragEvent;
    Object.setPrototypeOf(paste, (g.ClipboardEvent as typeof ClipboardEvent).prototype);
    box.dispatchEvent(paste);
    await new Promise((r) => setTimeout(r, 0));
    expect(onFiles).toHaveBeenCalledWith([shot]);
    expect(box.querySelector("img")).toBeNull();
  });
});
