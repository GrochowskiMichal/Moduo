// TV-D15 follow-up (D15-11) · copying needs Edit on the source: without it,
// Save as template and Duplicate project… say why instead of offering the
// action; while the app asks, the action waits.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { CopyProjectDialog, SaveTemplateDialog } from "./template-dialogs";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const source = { name: "Board pack", dated: true, people: false, startsOn: null };

describe("copying needs Edit (D15-11)", () => {
  it("Save as template says why when you can only view the task", () => {
    render(
      <SaveTemplateDialog
        open
        kind="task"
        defaultName="Board slides"
        access={false}
        onSave={rs.fn()}
        onClose={rs.fn()}
      />,
    );
    expect(
      screen.getByText("You need edit access to this task to save it as a template."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
    // The footer's Close (and the dialog's own ×), no action.
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(1);
  });

  it("Save as template waits while the app asks", () => {
    render(
      <SaveTemplateDialog
        open
        kind="project"
        defaultName="Board pack"
        access={null}
        onSave={rs.fn()}
        onClose={rs.fn()}
      />,
    );
    const save = screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("Duplicate says why when you can only view the project", () => {
    render(
      <CopyProjectDialog
        open
        mode="duplicate"
        source={source}
        access={false}
        onCreate={rs.fn()}
        onClose={rs.fn()}
      />,
    );
    expect(screen.getByText("You need edit access to this project to copy it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(1);
  });

  it("Duplicate is offered with Edit", () => {
    render(
      <CopyProjectDialog
        open
        mode="duplicate"
        source={source}
        access
        onCreate={rs.fn()}
        onClose={rs.fn()}
      />,
    );
    const go = screen.getByRole("button", { name: "Duplicate" }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
  });
});
