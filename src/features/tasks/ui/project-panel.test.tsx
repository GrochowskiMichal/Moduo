// The project overview's words (MOD-139): what happened in the project reads
// "Recently", not "Lately". Its title row's ⋯ holds Statuses… (MOD-150), its
// optional fields come from the task details' "+" line (MOD-151), a row's
// icon, picture and time sit on its title's first line (MOD-153), and the
// actions at its foot stack (MOD-154).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

import { TitleActionsScope } from "../../../components/app/title-actions";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { makeTask } from "../helpers";
import type { Bucket, Task } from "../model";
import { ProjectPanel } from "./project-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const PROJECT: Bucket = {
  id: "p1",
  workspaceId: "w",
  ownerId: "u1",
  name: "Website",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  deletedAt: null,
};

const TASK: Task = {
  ...makeTask({
    workspaceId: "w",
    bucketId: "p1",
    title: "Draft the launch post",
    position: "a",
    assigneeId: "u1",
    dueDate: "2026-10-20T12:00:00Z",
  }),
  id: "t1",
  creatorId: "u1",
  createdAt: "2026-10-14T09:00:00Z",
};

const pointer = { button: 0, pointerType: "mouse" } as const;

/** The property rows' labels, top to bottom. */
const rowLabels = () =>
  [...document.querySelectorAll("[data-slot=property-row] > span")].map((l) => l.textContent);

const sectionOf = (name: string) =>
  screen.getByRole("heading", { name }).closest("section") as HTMLElement;

describe("the project overview (MOD-139)", () => {
  it('names what happened in the project "Recently"', () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("heading", { name: "Recently" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Lately" })).toBeNull();
  });
});

describe("Statuses… in the title row's ⋯ (MOD-150)", () => {
  it("puts the ⋯ in the host's title row, and Statuses… opens the project's statuses", async () => {
    const slot = document.createElement("div");
    document.body.append(slot);
    const onEditStatuses = rs.fn();
    render(
      <TooltipProvider>
        <TitleActionsScope slot={slot}>
          <ProjectPanel
            project={PROJECT}
            tasks={[TASK]}
            sections={[]}
            canEdit
            onEdit={() => {}}
            onEditStatuses={onEditStatuses}
          />
        </TitleActionsScope>
      </TooltipProvider>,
    );
    const more = await within(slot).findByRole("button", { name: "Project actions" });
    fireEvent.pointerDown(more, pointer);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Statuses…"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Statuses…" }));
    expect(onEditStatuses).toHaveBeenCalledWith(PROJECT);
    slot.remove();
  });

  it("shows no ⋯ to someone who can't edit the project, or to an archived one", () => {
    const { rerender } = render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} onEditStatuses={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Project actions" })).toBeNull();
    rerender(
      <TooltipProvider>
        <ProjectPanel
          project={{ ...PROJECT, archivedAt: "2026-10-10T00:00:00Z" }}
          tasks={[TASK]}
          sections={[]}
          canEdit
          onEditStatuses={() => {}}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Project actions" })).toBeNull();
  });
});

describe("the optional fields' + line (MOD-151)", () => {
  it("is the task details' line: one control that opens a menu of the hidden fields", async () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} canEdit onEdit={() => {}} />
      </TooltipProvider>,
    );
    const line = await screen.findByRole("button", {
      name: "Add a property: Start, Lead, Client",
    });
    expect(line.querySelector("[data-slot=add-property-names]")?.textContent).toBe(
      "Start·Lead·Client",
    );
    fireEvent.pointerDown(line, pointer);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Start", "Lead", "Client"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Start" }));
    // Its row shows, empty, and the line offers the rest.
    expect(
      await screen.findByRole("button", { name: "Add a property: Lead, Client", hidden: true }),
    ).toBeTruthy();
    expect(rowLabels()).toEqual(["Status", "Start", "Target"]);
  });

  it("keeps a revealed field while another is revealed, as the task details do", async () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} canEdit onEdit={() => {}} />
      </TooltipProvider>,
    );
    const pick = async (name: string) => {
      fireEvent.keyDown(document.body, { key: "Escape" });
      const line = await screen.findByRole("button", { name: /^Add a property/, hidden: true });
      fireEvent.pointerDown(line, pointer);
      const menu = await screen.findByRole("menu");
      fireEvent.click(within(menu).getByRole("menuitem", { name }));
    };
    await pick("Start");
    await pick("Lead");
    expect(
      screen.getByRole("button", { name: "Add a property: Client", hidden: true }),
    ).toBeTruthy();
    expect(rowLabels()).toEqual(["Status", "Start", "Target", "Lead"]);
  });

  it("offers nothing to someone who can't edit the project", () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: /^Add a property/ })).toBeNull();
  });
});

describe("a row's first line (MOD-153)", () => {
  // jsdom lays nothing out: these pin the structure the browser lines up
  // (measured live in the MOD-153 report).
  it("puts Next up's status, date and picture on the title's first line", () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} />
      </TooltipProvider>,
    );
    const row = within(sectionOf("Next up")).getByRole("button", {
      name: /Draft the launch post/,
    });
    expect(row.className).toContain("items-start");
    expect(row.className).not.toContain("items-center");
    expect(row.className).toContain("py-(--row-first-line-pad)");
    const title = within(row).getByText("Draft the launch post");
    const sides = [...row.children].filter((c) => c !== title);
    // The status, the date and the picture, each in a box one line tall.
    expect(sides).toHaveLength(3);
    for (const box of sides) expect(box.className).toContain("h-lh");
    // The small date sits inside its box, so the box keeps the row's line.
    expect(sides[1].className).not.toContain("text-xs");
    expect(sides[1].firstElementChild?.className).toContain("text-xs");
  });

  it("puts Recently's day at the top, on the first line", () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} />
      </TooltipProvider>,
    );
    const row = within(sectionOf("Recently")).getByRole("button");
    expect(row.className).toContain("items-start");
    const day = row.lastElementChild as HTMLElement;
    expect(day.className).toContain("h-lh");
    expect(day.firstElementChild?.className).toContain("text-xs");
  });
});

describe("the actions at the foot (MOD-154)", () => {
  it("stack one under another, full width and left-aligned, in their order", async () => {
    render(
      <TooltipProvider>
        <ProjectPanel
          project={PROJECT}
          tasks={[TASK]}
          sections={[]}
          canEdit
          onEdit={() => {}}
          onArchive={() => {}}
          onDuplicate={() => {}}
        />
      </TooltipProvider>,
    );
    await screen.findByRole("button", { name: "Archive…" });
    const list = document.querySelector("[data-slot=project-actions]") as HTMLElement;
    expect(list.className).toContain("flex-col");
    expect(list.className).not.toContain("flex-wrap");
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Time report",
      "Copy as text",
      "Duplicate…",
      "Archive…",
    ]);
    for (const b of buttons) {
      expect(b.className).toContain("w-full");
      expect(b.className).toContain("justify-start");
      expect(b.dataset.variant).toBe("ghost");
    }
  });
});
