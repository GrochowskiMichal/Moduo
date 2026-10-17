// The project overview's words (MOD-139): what happened in the project reads
// "Recently", not "Lately". Its title row's ⋯ holds Statuses… (MOD-150), its
// optional fields come from the task details' "+" line (MOD-151), a row's
// icon, picture and time sit on its title's first line (MOD-153), the
// actions at its foot stack (MOD-154), and it shares the task details'
// title, headers, gap and divider, with Waiting where Next up was (MOD-152).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({ assignees: [], currentUserId: "u1", byId: () => null }),
  previewAssign: async () => null,
  initialsOf: () => "?",
}));

// No runtime by default (the project's own edit check then answers yes); a
// test sets one to answer the check itself. One object, so it keeps its
// identity across renders (gotchas/ui.md).
const runtime = rs.hoisted(() => ({ current: null as unknown }));
rs.mock("../../../lib/runtime", () => ({
  getRuntime: () => runtime.current,
  initRuntime: async () => runtime.current,
  isTauriRuntime: () => false,
  runtimeConfigError: null,
}));

import { TitleActionsScope } from "../../../components/app/title-actions";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { makeTask } from "../helpers";
import type { Bucket, Section, Task, TaskWaitingEntry } from "../model";
import { ProjectPanel } from "./project-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(() => {
  cleanup();
  runtime.current = null;
});

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

const DONE: Task = {
  ...makeTask({
    workspaceId: "w",
    bucketId: "p1",
    title: "Pick the domain",
    position: "b",
  }),
  id: "t2",
  status: "done",
  statusCategory: "done",
  creatorId: "u1",
  createdAt: "2026-10-13T09:00:00Z",
};

const WAIT: TaskWaitingEntry = {
  id: "w1",
  workspaceId: "w",
  taskId: "t1",
  kind: "text",
  ref: null,
  label: "the copy",
  since: "2026-10-15T09:00:00Z",
  createdBy: "u1",
  updatedAt: "2026-10-15T09:00:00Z",
};

const SECTION: Section = {
  id: "s1",
  workspaceId: "w",
  projectId: "p1",
  name: "Launch",
  position: 0,
  startsOn: null,
  endsOn: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
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

  it("shows no ⋯ on a project shared with you view-only, though you edit the workspace", async () => {
    let asked = false;
    runtime.current = {
      tasks: {
        canCopyTemplateSource: async () => {
          asked = true;
          return false;
        },
        timeReport: async () => ({ rows: [] }),
      },
    };
    render(
      <TooltipProvider>
        <ProjectPanel
          project={PROJECT}
          tasks={[TASK]}
          sections={[]}
          canEdit
          onEdit={() => {}}
          onEditStatuses={() => {}}
        />
      </TooltipProvider>,
    );
    await act(async () => {});
    expect(asked).toBe(true);
    expect(screen.queryByRole("button", { name: "Project actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add a property/ })).toBeNull();
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
    // Its editor is open, and stays open once the menu has closed: the menu
    // hands focus to no one, or the calendar would close at once.
    await act(async () => {});
    expect(screen.queryByRole("menu")).toBeNull();
    const start = screen.getByRole("button", { name: "Start date: Set a start", hidden: true });
    expect(start.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).not.toBe(line);
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
    // Lead's picker opened with it.
    await act(async () => {});
    expect(screen.getByPlaceholderText("Lead…")).toBeTruthy();
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
  it("puts Waiting's status and who it waits on on the title's first line", () => {
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} waiting={[WAIT]} />
      </TooltipProvider>,
    );
    const row = within(sectionOf("Waiting")).getByRole("button", {
      name: /Draft the launch post/,
    });
    expect(row.className).toContain("items-start");
    expect(row.className).not.toContain("items-center");
    expect(row.className).toContain("py-(--row-first-line-pad)");
    const title = within(row).getByText("Draft the launch post");
    const sides = [...row.children].filter((c) => c !== title);
    // The status, then "on the copy · Yesterday", each in a box one line tall.
    expect(sides).toHaveLength(2);
    for (const box of sides) expect(box.className).toContain("h-lh");
    // The small words sit inside their box, so the box keeps the row's line.
    expect(sides[1].className).not.toContain("text-xs");
    expect(sides[1].firstElementChild?.className).toContain("text-xs");
    expect(sides[1].textContent).toMatch(/^on the copy · \S/);
    // A long label gives way, cut short, once the title is down to 10
    // characters; the day never does (MOD-152).
    expect(title.className).toContain("min-w-[min(10ch,100%)]");
    expect(sides[1].className).toContain("min-w-0");
    expect(within(row).getByText("on the copy").className).toContain("truncate");
    const day = sides[1].firstElementChild?.lastElementChild as HTMLElement;
    expect(day.textContent?.startsWith(" · ")).toBe(true);
    expect(day.className).toContain("shrink-0");
  });

  it('keeps "+1" with the day when a task waits on more than one thing', () => {
    const more: TaskWaitingEntry = { ...WAIT, id: "w2", label: "the logo files" };
    render(
      <TooltipProvider>
        <ProjectPanel project={PROJECT} tasks={[TASK]} sections={[]} waiting={[WAIT, more]} />
      </TooltipProvider>,
    );
    const row = within(sectionOf("Waiting")).getByRole("button", {
      name: /Draft the launch post/,
    });
    // The label may be cut short; the count of the others never is.
    expect(within(row).getByText("on the copy").className).toContain("truncate");
    const tail = within(row).getByText(/^\+1 · /);
    expect(tail.className).toContain("shrink-0");
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

describe("one hierarchy with the task details (MOD-152)", () => {
  const renderFull = () =>
    render(
      <TooltipProvider>
        <ProjectPanel
          project={{ ...PROJECT, leadId: "u1" }}
          tasks={[TASK, DONE]}
          sections={[SECTION]}
          waiting={[WAIT]}
        />
      </TooltipProvider>,
    );

  it("has no Next up: Waiting takes its place, right after Progress", () => {
    renderFull();
    expect(screen.queryByRole("heading", { name: "Next up" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Progress",
      "Waiting",
      "Sections",
      "People",
      "Recently",
    ]);
  });

  it("starts every section, and the actions, on the details' hairline, 16 px either side", () => {
    renderFull();
    const record = screen.getByRole("heading", { level: 3, name: "Website" });
    const column = record.closest(".pane-scroll") as HTMLElement;
    expect(column.className).toContain("gap-4");
    const blocks = [...column.children];
    const lines = blocks.filter((b) => b.getAttribute("data-slot") === "separator");
    // Progress, Waiting, Sections, People, Recently and the actions.
    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(line.className).toContain("bg-hairline");
      const next = line.nextElementSibling as HTMLElement;
      expect(next.tagName === "SECTION" || next.dataset.slot === "project-actions").toBe(true);
    }
    // Every section follows a line; the record (title, properties,
    // description) opens the view without one.
    for (const section of column.querySelectorAll(":scope > section")) {
      expect(section.previousElementSibling?.getAttribute("data-slot")).toBe("separator");
    }
    expect(blocks[0].getAttribute("data-slot")).not.toBe("separator");
  });

  it('heads Progress with "1 of 2 done" and keeps the rest as meta, without repeating it', () => {
    renderFull();
    const header = screen
      .getByRole("heading", { name: "Progress" })
      .closest("[data-slot=collection-header]") as HTMLElement;
    expect(header.textContent).toBe("Progress1 of 2 done");
    const lines = [
      ...(document.querySelector("[data-slot=project-progress]") as HTMLElement).querySelectorAll(
        "p",
      ),
    ];
    expect(lines.map((l) => l.textContent)).toEqual(["1 open", "Done this month · 0"]);
    for (const line of lines) {
      expect(line.className).toContain("text-xs");
      expect(line.className).toContain("text-muted-foreground");
    }
  });

  it("names the project in the task title's style", () => {
    renderFull();
    const title = screen.getByRole("heading", { level: 3, name: "Website" });
    expect(title.dataset.slot).toBe("detail-title");
    for (const c of ["text-lg", "font-semibold", "leading-snug", "tracking-tight", "break-words"])
      expect(title.className).toContain(c);
  });

  it("still lists the open tasks in Copy as text", async () => {
    const writeText = rs.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      renderFull();
      fireEvent.click(screen.getByRole("button", { name: "Copy as text" }));
      await act(async () => {});
      expect(writeText).toHaveBeenCalledTimes(1);
      const text = writeText.mock.calls[0][0];
      expect(text).toContain("1 of 2 done · 1 open");
      expect(text).toContain("- [ ] Draft the launch post");
      expect(text).not.toContain("Pick the domain");
    } finally {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    }
  });
});
