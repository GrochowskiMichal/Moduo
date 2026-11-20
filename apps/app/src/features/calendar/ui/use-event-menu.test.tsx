// AC26 + AC22's ⌃↵ (CALR-4b): right-click an event, or ⌃↵ on the selected
// one, opens a short menu without shortcuts; the Event panel's ⋯ shows the
// same items with their keys. Each item reuses the keyboard's own action
// (copy, duplicate, delete with Undo, the panel's V / P / L), and an item
// that hands focus to something else runs only once the menu has closed.

process.env.TZ = "Europe/Warsaw";

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { HotkeyScope } from "../../../lib/hotkeys";
import type { CalendarAccountModel, CalendarEventModel, EventChip } from "../events";
import { useEventMenu } from "./use-event-menu";

afterEach(cleanup);

const ME = "u-me";
const START = Date.parse("2026-11-03T10:00:00.000Z");
const END = Date.parse("2026-11-03T11:00:00.000Z");

function event(over: Partial<CalendarEventModel> = {}): CalendarEventModel {
  return {
    id: "ev-a",
    workspaceId: "ws-1",
    ownerId: ME,
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Design review",
    description: "",
    startsAt: "2026-11-03T10:00:00.000Z",
    endsAt: "2026-11-03T11:00:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    location: null,
    color: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    deletedAt: null,
    attendees: [],
    isPrivate: false,
    ...over,
  };
}

function chip(e: CalendarEventModel): EventChip {
  return {
    eventId: e.id,
    occurrenceKey: `${e.id}:${START}`,
    title: e.title,
    startMs: START,
    endMs: END,
    dayKey: "2026-11-03",
    allDay: false,
    external: e.sourceAccountId !== null,
    readOnly: false,
    recurring: false,
    sourceAccountId: e.sourceAccountId,
    color: null,
    continuesFromMs: null,
    continuesToMs: null,
    locked: false,
  };
}

const WORK: CalendarAccountModel = {
  id: "acc-work",
  workspaceId: "ws-1",
  ownerId: ME,
  provider: "google",
  externalId: "work@group.calendar.google.com",
  displayLabel: "Work",
  isDefaultTarget: false,
  color: null,
  lastSyncAt: null,
  status: "active",
  syncToken: null,
  deletedAt: null,
  readOnly: false,
};

function setup(
  opts: { selected?: string | null; events?: CalendarEventModel[]; canEdit?: boolean } = {},
) {
  const events = opts.events ?? [event()];
  const chips = events.map(chip);
  const deps = {
    select: rs.fn(),
    openDetail: rs.fn(),
    patchEvent: rs.fn(),
    requestEventDelete: rs.fn(),
    copyChip: rs.fn(),
    duplicateChip: rs.fn(),
    moveEvent: rs.fn(),
  };
  let panelMenu: ((e: CalendarEventModel) => ReactNode) | null = null;
  function Harness({ selected }: { selected: string | null }) {
    const menu = useEventMenu({
      chips: { timed: new Map([["2026-11-03", chips]]), allDay: new Map() },
      eventsById: new Map(events.map((e) => [e.id, e])),
      accounts: [WORK],
      userId: ME,
      canEdit: opts.canEdit ?? true,
      selectedOccurrenceKey: selected,
      ...deps,
    });
    panelMenu = menu.panelMenu;
    return (
      <div>
        <div data-calendar-grid="" tabIndex={0}>
          {chips.map((c) => (
            <div key={c.occurrenceKey} data-chip="event" data-occurrence-key={c.occurrenceKey}>
              <span data-chip="event">{c.title}</span>
            </div>
          ))}
        </div>
        <div data-testid="panel">{menu.panelMenu(events[0]!)}</div>
        {menu.menu}
      </div>
    );
  }
  const view = render(
    <TooltipProvider>
      <HotkeyScope scope="calendar">
        <Harness selected={opts.selected ?? null} />
      </HotkeyScope>
    </TooltipProvider>,
  );
  return { ...deps, view, chips, panelMenu: () => panelMenu };
}

const SHORTCUT = '[data-slot="dropdown-menu-shortcut"]';

function rightClick(title: string) {
  fireEvent.contextMenu(screen.getByText(title), { clientX: 200, clientY: 300, button: 2 });
}

function itemNames(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim());
}

describe("the right-click menu", () => {
  it("opens on an event with the spec's items and no shortcuts, and selects it", async () => {
    const { select, chips } = setup();
    rightClick("Design review");
    const menu = await screen.findByRole("menu");
    expect(itemNames(menu)).toEqual([
      "Open",
      "Copy",
      "Duplicate",
      "Make private",
      "Move to another calendar",
      "Link a person, note or task",
      "Delete",
    ]);
    expect(menu.querySelectorAll(SHORTCUT)).toHaveLength(0);
    expect(select).toHaveBeenCalledWith(chips[0]!.occurrenceKey);
  });

  it("leaves the browser's own menu alone off an event", () => {
    setup();
    const grid = document.querySelector("[data-calendar-grid]")!;
    const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    grid.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Duplicate and Copy run the keyboard's own actions on that occurrence", async () => {
    const { duplicateChip, copyChip, chips } = setup();
    rightClick("Design review");
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Duplicate" }),
    );
    await waitFor(() => expect(duplicateChip).toHaveBeenCalledWith(chips[0]));

    rightClick("Design review");
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Copy" }),
    );
    await waitFor(() => expect(copyChip).toHaveBeenCalledWith(chips[0]));
  });

  it("Delete asks the way ⌫ does, for that occurrence", async () => {
    const { requestEventDelete } = setup();
    rightClick("Design review");
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Delete" }),
    );
    await waitFor(() => expect(requestEventDelete).toHaveBeenCalledWith("ev-a", START));
  });

  it("Make private patches the event; Open opens the Event panel", async () => {
    const { patchEvent, openDetail } = setup();
    rightClick("Design review");
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Make private" }),
    );
    await waitFor(() => expect(patchEvent).toHaveBeenCalledWith("ev-a", { isPrivate: true }));

    rightClick("Design review");
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Open" }),
    );
    await waitFor(() => expect(openDetail).toHaveBeenCalledWith({ type: "event", id: "ev-a" }));
  });

  it("Link opens the Event panel on that event", async () => {
    const { openDetail } = setup();
    rightClick("Design review");
    fireEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Link a person, note or task",
      }),
    );
    await waitFor(() => expect(openDetail).toHaveBeenCalledWith({ type: "event", id: "ev-a" }));
  });

  it("an action waits for the menu to close (focus-taking surfaces, rules: ui-radix)", async () => {
    const { requestEventDelete } = setup();
    rightClick("Design review");
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(requestEventDelete).toHaveBeenCalledTimes(1));
  });

  it("Escape closes it and gives focus back to the grid", async () => {
    setup();
    const grid = document.querySelector<HTMLElement>("[data-calendar-grid]")!;
    grid.focus();
    rightClick("Design review");
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(grid));
  });
});

describe("⌃↵", () => {
  it("opens the same menu at the selected event", async () => {
    const selected = `ev-a:${START}`;
    setup({ selected });
    const grid = document.querySelector<HTMLElement>("[data-calendar-grid]")!;
    grid.focus();
    act(() => {
      fireEvent.keyDown(grid, { key: "Enter", code: "Enter", ctrlKey: true });
    });
    const menu = await screen.findByRole("menu");
    expect(itemNames(menu)[0]).toBe("Open");
    expect(menu.querySelectorAll(SHORTCUT)).toHaveLength(0);
  });

  it("does nothing with no event selected", async () => {
    setup({ selected: null });
    const grid = document.querySelector<HTMLElement>("[data-calendar-grid]")!;
    grid.focus();
    act(() => {
      fireEvent.keyDown(grid, { key: "Enter", code: "Enter", ctrlKey: true });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the Event panel's ⋯", () => {
  it("shows the same items (but Open) with their keys", async () => {
    setup();
    const more = within(screen.getByTestId("panel")).getByRole("button", {
      name: "Event actions",
    });
    fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
    const menu = await screen.findByRole("menu");
    const rows = within(menu).getAllByRole("menuitem");
    const named = rows.map((row) => ({
      name: row.textContent?.replace(row.querySelector(SHORTCUT)?.textContent ?? "", "").trim(),
      key: row.querySelector(SHORTCUT)?.textContent ?? null,
    }));
    expect(named).toEqual([
      { name: "Copy", key: "Ctrl C" },
      { name: "Duplicate", key: "Ctrl D" },
      { name: "Make private", key: "P" },
      { name: "Move to another calendar", key: null },
      { name: "Link a person, note or task", key: "L" },
      { name: "Delete", key: "⌫" },
    ]);
  });

  it("its items run the same actions", async () => {
    const { requestEventDelete } = setup();
    const more = within(screen.getByTestId("panel")).getByRole("button", {
      name: "Event actions",
    });
    fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Delete/ }));
    await waitFor(() => expect(requestEventDelete).toHaveBeenCalledWith("ev-a", START));
  });
});
