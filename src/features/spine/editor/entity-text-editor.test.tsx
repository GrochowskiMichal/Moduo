// DF-23 — the blur-commit must baseline against the SERIALIZED seed, so merely
// focusing then leaving a migrated (legacy plain-text) description does NOT fire
// a spurious write (updatedAt bump / phantom activity row). Regression guard for
// the senior-review finding.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityTextEditor } from "./entity-text-editor";

afterEach(cleanup);

describe("EntityTextEditor commit-on-blur", () => {
  it("does not commit when a legacy plain-text value is focused then left untouched", () => {
    const onCommit = vi.fn();
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
