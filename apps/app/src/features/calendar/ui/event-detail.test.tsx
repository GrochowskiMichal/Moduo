// AC25 (CALR-10): the Event view follows the selection and shows the event's
// calendar, who sees it, where (place with Map, link with Copy), the booking it
// came through, people with replies, and its notes and tasks as two-line rows,
// with Link a person, note or task.

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { EntityLink, EntityRecord } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { EventContext } from "../event-view";
import type { CalendarAccountModel, CalendarEventModel } from "../events";
import { EventDetailPanel } from "./event-detail-panel";

afterEach(cleanup);

const WS = "ws-1";
const ME = "u-me";

function event(over: Partial<CalendarEventModel>): CalendarEventModel {
  return {
    id: "ev-a",
    workspaceId: WS,
    ownerId: ME,
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    calendarRef: "cal-1",
    title: "October update",
    description: "",
    startsAt: "2026-10-27T16:00:00.000Z",
    endsAt: "2026-10-27T17:00:00.000Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    location: null,
    color: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    deletedAt: null,
    attendees: [],
    ...over,
  };
}

const A = event({
  id: "ev-a",
  title: "October update with Priya",
  location: "Hale & Co, 12 Rue Oberkampf, Paris",
  conferenceUrl: "https://meet.google.com/abc-defg-hij",
  conferenceProvider: "google_meet",
  attendees: [
    { email: "priya@acme.com", name: "Priya Shah", status: "accepted" },
    { email: "kai@hale.co", name: "Kai Ito", status: "tentative" },
  ],
});

const B = event({
  id: "ev-b",
  title: "Design crit",
  location: "Studio",
  conferenceUrl: null,
  attendees: [{ email: "nora@hale.co", name: "Nora Lind", status: "declined" }],
});

function link(id: string, eventId: string, type: "note" | "task", otherId: string): EntityLink {
  return {
    id,
    workspaceId: WS,
    sourceType: "event",
    sourceId: eventId,
    targetType: type,
    targetId: otherId,
    relationKind: "references",
    origin: "manual",
    createdBy: ME,
    createdAt: "2026-10-20T10:00:00.000Z",
    deletedAt: null,
  };
}

const LINKS: Record<string, EntityLink[]> = {
  "ev-a": [link("l1", "ev-a", "note", "n-1"), link("l2", "ev-a", "task", "t-1")],
  "ev-b": [link("l3", "ev-b", "note", "n-2")],
};
const RECORDS: Record<string, EntityRecord> = {
  "n-1": {
    workspaceId: WS,
    type: "note",
    id: "n-1",
    label: "Q4 numbers",
    icon: null,
    deletedAt: null,
  },
  "t-1": {
    workspaceId: WS,
    type: "task",
    id: "t-1",
    label: "Send the deck",
    icon: null,
    deletedAt: null,
  },
  "n-2": {
    workspaceId: WS,
    type: "note",
    id: "n-2",
    label: "Crit agenda",
    icon: null,
    deletedAt: null,
  },
};

const runtime = {
  spine: {
    listLinks: async ({ entityId }: { entityId: string }) => LINKS[entityId] ?? [],
    getEntities: async ({ refs }: { refs: { id: string }[] }) =>
      refs.map((r) => RECORDS[r.id]).filter(Boolean),
  },
  tasks: { listActivity: async () => [] },
} as unknown as ModuoRuntime;

const members = [
  { userId: ME, name: "Robin Hale" },
  { userId: "u-kai", name: "Kai Ito" },
  { userId: "u-nora", name: "Nora Lind" },
];

const contexts: Record<string, EventContext> = {
  "ev-a": {
    calendarName: "Your calendar",
    share: { workspaceLevel: "freebusy", people: [{ userId: "u-kai", level: "view" }] },
    bookedThrough: { name: "30-minute intro", bookedAt: "2026-10-24T09:00:00.000Z" },
  },
  "ev-b": {
    calendarName: "Your calendar",
    share: { workspaceLevel: null, people: [] },
    bookedThrough: null,
  },
};
const loadContext = async (e: Pick<CalendarEventModel, "id">) => contexts[e.id]!;

const accounts: CalendarAccountModel[] = [];

function panel(e: CalendarEventModel, canEdit = false) {
  return (
    <TooltipProvider>
      <EventDetailPanel
        runtime={runtime}
        workspaceId={WS}
        currentUserId={ME}
        event={e}
        accounts={accounts}
        members={members}
        canEdit={canEdit}
        writable={canEdit}
        loadContext={loadContext}
        onPatch={() => {}}
        onDeleteRequest={() => {}}
        onClose={() => {}}
      />
    </TooltipProvider>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A two-line row: its first line and second line, each its own element. */
function twoLine(first: string, second: string) {
  const top = screen.getByText(first);
  const row = top.closest("[data-row='two-line']");
  expect(row).not.toBeNull();
  expect(row!.textContent).toContain(second);
  expect(top.textContent).not.toContain(second);
  return row as HTMLElement;
}

describe("event view follows the selection", () => {
  it("shows calendar, who sees it, where, booked through, people, notes and tasks", async () => {
    render(panel(A));
    await settle();

    expect(screen.getByText("Your calendar")).toBeTruthy();
    expect(screen.getByText("Kai Ito sees it all · others see “Busy”")).toBeTruthy();
    expect(screen.getByText(/Booked through 30-minute intro/)).toBeTruthy();

    // Where: the place on two lines with Map, the link on two lines with Copy.
    twoLine("Hale & Co", "12 Rue Oberkampf, Paris");
    const map = screen.getByRole("link", { name: /map/i });
    expect(map.getAttribute("href")).toContain("google.com/maps");
    twoLine("Google Meet", "https://meet.google.com/abc-defg-hij");
    expect(screen.getByRole("button", { name: /copy the meeting link/i })).toBeTruthy();

    // People with their replies.
    const priya = twoLine("Priya Shah", "priya@acme.com");
    expect(priya.textContent).toContain("Accepted");
    expect(twoLine("Kai Ito", "kai@hale.co").textContent).toContain("Maybe");

    // Notes and tasks as two-line rows.
    twoLine("Q4 numbers", "Note");
    twoLine("Send the deck", "Task");
  });

  it("selecting another event updates the view", async () => {
    const { rerender } = render(panel(A));
    await settle();
    rerender(panel(B));
    await settle();

    expect(screen.queryByText("Hale & Co")).toBeNull();
    expect(screen.queryByText("Priya Shah")).toBeNull();
    expect(screen.queryByText("Q4 numbers")).toBeNull();
    expect(screen.queryByText(/Booked through/)).toBeNull();
    twoLine("Nora Lind", "nora@hale.co");
    expect(screen.getByText("Declined")).toBeTruthy();
    twoLine("Crit agenda", "Note");
    expect(screen.getByText("Only you see it")).toBeTruthy();
  });

  it("offers Add a place and Link when you can edit, and no Meet link a Moduo event can't make", async () => {
    render(panel(event({ id: "ev-b", location: null, conferenceUrl: null }), true));
    await settle();
    expect(screen.getByRole("button", { name: /add a place/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add a meet link/i })).toBeNull();
    expect(screen.getByRole("button", { name: /link a person, note or task/i })).toBeTruthy();
  });

  it("offers Add a Meet link on a Google event you can edit", async () => {
    render(
      panel(
        event({ id: "ev-b", sourceAccountId: "acc-g", externalEventId: "g1", conferenceUrl: null }),
        true,
      ),
    );
    await settle();
    expect(screen.getByRole("button", { name: /add a meet link/i })).toBeTruthy();
  });
});
