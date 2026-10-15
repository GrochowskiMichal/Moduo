// MOD-97 · a task template's tags are the dot chips of the details panel:
// removable while you can edit the template, read-only when you can't.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("../../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
}));

import { TooltipProvider } from "../../../../components/ui/tooltip";
import type { TaskTemplateBody, TemplateTask, TemplateWithBody } from "../model";
import { TemplateEditor } from "./template-editor";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const root: TemplateTask = {
  title: "Ship the release",
  description: "",
  parent: null,
  position: null,
  priority: null,
  energy: null,
  estimate: null,
  due: null,
  due_time: null,
  assignee: null,
  team: null,
  tags: [
    { id: "g1", name: "launch", color: "blue" },
    { id: "g2", name: "website", color: "teal" },
  ],
  links: [],
};

const body: TaskTemplateBody = {
  v: 1,
  kind: "task",
  anchor: "start",
  project: null,
  section: null,
  tasks: [root],
  relations: [],
};

const template: TemplateWithBody = {
  id: "tpl1",
  kind: "task",
  workspaceId: "w1",
  ownerId: "u1",
  name: "Release",
  shared: false,
  privateSource: false,
  shareable: true,
  facts: {
    tasks: 1,
    top: 1,
    sections: 0,
    dated: false,
    people: false,
    anchor: "start",
    title: "Ship the release",
    project: null,
  },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
  body,
};

function renderEditor(canEdit: boolean) {
  render(
    <TooltipProvider>
      <TemplateEditor
        template={template}
        loading={false}
        canEdit={canEdit}
        projects={[]}
        onSave={rs.fn(async () => true)}
        onUse={null}
        onClose={rs.fn()}
      />
    </TooltipProvider>,
  );
}

const chips = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="tag-chip"]')].map((c) => c.textContent);

describe("template tags (MOD-97)", () => {
  it("shows each tag as a md dot chip in its hue, and × removes it from the draft", () => {
    renderEditor(true);
    expect(chips()).toEqual(["launch", "website"]);
    const launch = screen
      .getByTitle("Tag: launch")
      .closest('[data-slot="tag-chip"]') as HTMLElement;
    expect(launch.getAttribute("data-label")).toBe("blue");
    expect(launch.className).toContain("h-5.5");
    fireEvent.click(screen.getByRole("button", { name: "Remove tag launch" }));
    expect(chips()).toEqual(["website"]);
    expect(screen.getByText("Not saved yet")).toBeTruthy();
  });

  it("hides the × when you can't edit the template", () => {
    renderEditor(false);
    expect(chips()).toEqual(["launch", "website"]);
    expect(screen.queryByRole("button", { name: /^Remove tag/ })).toBeNull();
  });
});
