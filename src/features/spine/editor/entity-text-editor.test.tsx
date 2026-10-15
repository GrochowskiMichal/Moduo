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

describe("EntityTextEditor surfaces (MOD-115)", () => {
  const editor = (surface?: "ring" | "soft") =>
    render(
      <EntityTextEditor
        value="Some notes"
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "event", id: "e-1" }}
        ariaLabel="Notes"
        placeholder="Notes…"
        surface={surface}
      />,
    );

  it("keeps the ring by default (Calendar's notes look as before)", () => {
    editor();
    const box = screen.getByLabelText("Notes");
    expect(box.className).toContain("focus-visible:ring-2");
    expect(box.className).not.toContain("focus:bg-state-hover");
  });

  it("soft: plain text at rest, a quiet fill with its padding inside while editing", () => {
    editor("soft");
    const box = screen.getByLabelText("Notes");
    expect(box.className).toContain("focus:bg-state-hover");
    expect(box.className).toContain("px-2");
    expect(box.className).not.toContain("ring");
  });
});

describe("EntityTextEditor plain-text lists", () => {
  it("shows an imported Markdown list as bullet lines, and a bare visit writes nothing", () => {
    const onCommit = rs.fn();
    render(
      <EntityTextEditor
        value={"Cut list:\n- short\n- long"}
        editable
        runtime={null}
        workspaceId={null}
        source={{ type: "task", id: "t-1" }}
        ariaLabel="Description"
        onCommit={onCommit}
      />,
    );
    const box = screen.getByLabelText("Description");
    expect(box.textContent).toContain("• short");
    expect(box.textContent).toContain("• long");
    expect(box.textContent).not.toContain("- short");
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
