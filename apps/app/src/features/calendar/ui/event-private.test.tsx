// AC28 (CALR-15): a private event (P) shows as Busy to every teammate, carries a
// lock for you, and for a Google event sets Google's visibility. Here, the app
// side: who may make an event private, the lock on your own chip, the Event
// view's Private switch and P key, and its visibility line.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { HotkeyScope } from "../../../lib/hotkeys";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { canMakePrivate, type EventContext, showsLock, whoSeesLine } from "../event-view";
import type { CalendarEventModel } from "../events";
import { EventChipView } from "./event-chip";
import { EventDetailPanel } from "./event-detail-panel";

afterEach(cleanup);

const WS = "ws-1";
const ME = "u-me";
const KAI = "u-kai";
const PRIVATE_LINE = "Private · teammates see “Busy”";

function event(over: Partial<CalendarEventModel> = {}): CalendarEventModel {
  return {
    id: "ev-a",
    workspaceId: WS,
    ownerId: ME,
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    calendarRef: "cal-1",
    title: "Therapy",
    description: "",
    startsAt: "2026-11-03T17:00:00.000Z",
    endsAt: "2026-11-03T18:00:00.000Z",
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

const members = [
  { userId: ME, name: "Robin Hale" },
  { userId: KAI, name: "Kai Ito" },
];

describe("the pure pieces", () => {
  it("says a private event is busy to teammates, whatever the calendar's sharing", () => {
    const allDetails = { workspaceLevel: "view", people: [] };
    expect(whoSeesLine(allDetails, members, ME)).toBe("Everyone here sees it all");
    expect(whoSeesLine(allDetails, members, ME, { isPrivate: true })).toBe(PRIVATE_LINE);
    expect(
      whoSeesLine({ workspaceLevel: null, people: [] }, members, ME, { isPrivate: true }),
    ).toBe(PRIVATE_LINE);
    expect(whoSeesLine(allDetails, members, ME, { isPrivate: false })).toBe(
      "Everyone here sees it all",
    );
  });

  it("lets only the event's owner make it private, and only where it can change", () => {
    expect(canMakePrivate(event(), ME, true)).toBe(true);
    expect(
      canMakePrivate(event({ sourceAccountId: "acc-g", externalEventId: "g1" }), ME, true),
    ).toBe(true);
    expect(canMakePrivate(event({ ownerId: KAI }), ME, true)).toBe(false);
    expect(canMakePrivate(event(), ME, false)).toBe(false);
    expect(canMakePrivate(event(), null, true)).toBe(false);
  });

  it("puts the lock on your own private events only", () => {
    expect(showsLock(event({ isPrivate: true }), ME)).toBe(true);
    expect(showsLock(event({ isPrivate: false }), ME)).toBe(false);
    // A teammate's private event reaches you as "Busy": no lock, nothing to tell.
    expect(showsLock(event({ isPrivate: true, ownerId: KAI }), ME)).toBe(false);
    expect(showsLock(event({ isPrivate: true }), null)).toBe(false);
  });
});

describe("the chip", () => {
  const chip = (locked: boolean) =>
    render(
      <EventChipView
        title="Therapy"
        startMs={Date.parse("2026-11-03T17:00:00.000Z")}
        endMs={Date.parse("2026-11-03T18:00:00.000Z")}
        hue="gray"
        compact={false}
        readOnly={false}
        recurring={false}
        selected={false}
        past={false}
        locked={locked}
      />,
    );

  it("carries a lock when it is yours and private", () => {
    const { container } = chip(true);
    const root = container.querySelector("[data-chip='event']");
    expect(root?.hasAttribute("data-private")).toBe(true);
    expect(screen.getByLabelText("Private")).toBeTruthy();
  });

  it("and none otherwise", () => {
    const { container } = chip(false);
    expect(container.querySelector("[data-chip='event']")?.hasAttribute("data-private")).toBe(
      false,
    );
    expect(screen.queryByLabelText("Private")).toBeNull();
  });
});

const runtime = {
  spine: { listLinks: async () => [], getEntities: async () => [] },
  tasks: { listActivity: async () => [] },
} as unknown as ModuoRuntime;

const context: EventContext = {
  calendarName: "Your calendar",
  calendarOwnerId: ME,
  share: { workspaceLevel: "view", people: [] },
  bookedThrough: null,
};

function panel(
  e: CalendarEventModel,
  onPatch: (id: string, patch: object) => void,
  canEdit = true,
) {
  return (
    <TooltipProvider>
      <HotkeyScope scope="calendar">
        <EventDetailPanel
          runtime={runtime}
          workspaceId={WS}
          currentUserId={ME}
          event={e}
          accounts={[]}
          members={members}
          canEdit={canEdit}
          writable={canEdit}
          loadContext={async () => context}
          onPatch={onPatch}
          onDeleteRequest={() => {}}
          onClose={() => {}}
        />
      </HotkeyScope>
    </TooltipProvider>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function pressP() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true, cancelable: true }),
    );
  });
}

describe("the Event view", () => {
  it("offers a Private switch on your own event, and the switch saves it", async () => {
    const onPatch = rs.fn();
    render(panel(event(), onPatch));
    await settle();
    const toggle = screen.getByRole("switch", { name: "Private" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onPatch).toHaveBeenCalledWith("ev-a", { isPrivate: true });
  });

  it("P makes it private, and P again makes it public", async () => {
    const onPatch = rs.fn();
    const { rerender } = render(panel(event(), onPatch));
    await settle();
    pressP();
    expect(onPatch).toHaveBeenLastCalledWith("ev-a", { isPrivate: true });
    rerender(panel(event({ isPrivate: true }), onPatch));
    await settle();
    pressP();
    expect(onPatch).toHaveBeenLastCalledWith("ev-a", { isPrivate: false });
  });

  it("on a private event, the visibility line says teammates see Busy", async () => {
    render(panel(event({ isPrivate: true }), () => {}));
    await settle();
    expect(screen.getByText(PRIVATE_LINE)).toBeTruthy();
    expect(screen.queryByText("Everyone here sees it all")).toBeNull();
    expect(screen.getByRole("switch", { name: "Private" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("works on your Google event too (the save goes to Google first)", async () => {
    const onPatch = rs.fn();
    render(panel(event({ sourceAccountId: "acc-g", externalEventId: "g1" }), onPatch));
    await settle();
    fireEvent.click(screen.getByRole("switch", { name: "Private" }));
    expect(onPatch).toHaveBeenCalledWith("ev-a", { isPrivate: true });
  });

  it("offers nothing on a teammate's event, and P does nothing there", async () => {
    const onPatch = rs.fn();
    render(panel(event({ ownerId: KAI }), onPatch));
    await settle();
    expect(screen.queryByRole("switch", { name: "Private" })).toBeNull();
    pressP();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("nor on your event where it can't change", async () => {
    const onPatch = rs.fn();
    render(panel(event(), onPatch, false));
    await settle();
    expect(screen.queryByRole("switch", { name: "Private" })).toBeNull();
    pressP();
    expect(onPatch).not.toHaveBeenCalled();
  });
});
