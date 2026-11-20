// AC13: Day view shows, in the free width beside each meeting, its people, its
// linked notes, one follow-up and where it happens (the meeting link, or the
// place). The links come from one read per meeting plus one batched registry
// read for everything they point at.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

import type { EntityLink, EntityRecord, EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { dayPrep } from "../day-prep";
import type { CalendarEventModel } from "../events";
import { DayPrepAside } from "./day-prep";
import { EventChipView } from "./event-chip";
import { useDayPrepLinks } from "./use-day-prep";

afterEach(cleanup);

type PrepEvent = Pick<
  CalendarEventModel,
  "attendees" | "conferenceUrl" | "conferenceProvider" | "location"
>;

const meeting: PrepEvent = {
  attendees: [
    { email: "me@moduo.app", name: "Mike", status: "accepted", self: true },
    { email: "priya@acme.com", name: "Priya Shah", status: "accepted" },
    { email: "tom@acme.com", name: "", status: "needsAction" },
  ],
  conferenceUrl: "https://meet.google.com/abc-defg-hij",
  conferenceProvider: "google_meet",
  location: "Acme HQ, 1 Main St",
};

const links = {
  notes: [
    { id: "n1", title: "Board prep" },
    { id: "n2", title: "Q3 numbers" },
    { id: "n3", title: "Old notes" },
  ],
  tasks: [
    { id: "t1", title: "Already sent", done: true },
    { id: "t2", title: "Send the deck to Priya", done: false },
    { id: "t3", title: "Book the room", done: false },
  ],
};

describe("day view prep", () => {
  it("reads the people (not you), two notes, the first open follow-up and the link", () => {
    const prep = dayPrep(meeting, links);
    expect(prep.people.map((p) => p.name)).toEqual(["Priya Shah", "tom"]);
    expect(prep.people[0].initials).toBe("PS");
    expect(prep.notes.map((n) => n.title)).toEqual(["Board prep", "Q3 numbers"]);
    expect(prep.followUp?.title).toBe("Send the deck to Priya");
    // The meeting link wins over the place.
    expect(prep.where).toEqual({ kind: "link", label: "Meet" });
  });

  it("falls back to the place's name, and to nothing when there is neither", () => {
    const inRoom = dayPrep({ ...meeting, conferenceUrl: null, conferenceProvider: null }, null);
    expect(inRoom.where).toEqual({ kind: "place", label: "Acme HQ" });
    expect(inRoom.notes).toEqual([]);
    expect(inRoom.followUp).toBeNull();
    const bare = dayPrep({ attendees: [], conferenceUrl: null, location: null }, null);
    expect(bare.where).toBeNull();
    expect(bare.people).toEqual([]);
    expect(
      dayPrep({ ...meeting, conferenceUrl: null, location: "https://zoom.us/j/1" }, null).where,
    ).toEqual({
      kind: "link",
      label: "Zoom",
    });
  });

  it("shows each part beside the meeting", () => {
    render(<DayPrepAside prep={dayPrep(meeting, links)} />);
    expect(screen.getByLabelText("Priya Shah")).toBeTruthy();
    expect(screen.getByText("Board prep")).toBeTruthy();
    expect(screen.getByText("Q3 numbers")).toBeTruthy();
    expect(screen.queryByText("Old notes")).toBeNull();
    expect(screen.getByText("Send the deck to Priya")).toBeTruthy();
    expect(screen.queryByText("Book the room")).toBeNull();
    expect(screen.getByText("Meet")).toBeTruthy();
  });

  it("draws nothing when a meeting has nothing to prepare", () => {
    const { container } = render(
      <DayPrepAside prep={dayPrep({ attendees: [], conferenceUrl: null, location: null }, null)} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("sits in the chip's free width, on one-line chips too", () => {
    for (const compact of [false, true]) {
      const { container } = render(
        <EventChipView
          title="Board sync"
          startMs={0}
          endMs={3_600_000}
          hue="blue"
          compact={compact}
          readOnly={false}
          recurring={false}
          selected={false}
          past={false}
          aside={<DayPrepAside prep={dayPrep(meeting, links)} />}
        />,
      );
      const aside = container.querySelector("[data-chip-aside]");
      expect(aside).toBeTruthy();
      expect(aside?.textContent).toContain("Board prep");
      cleanup();
    }
  });

  it("reads each meeting's links once and the linked items in one batch", async () => {
    const calls: string[] = [];
    const linkRows: Record<string, EntityLink[]> = {
      e1: [link("l1", "e1", "note", "n1"), link("l2", "e1", "task", "t2")],
      e2: [link("l3", "e2", "contact", "c1")],
    };
    const records: EntityRecord[] = [
      record("note", "n1", "Board prep"),
      record("task", "t2", "Send the deck to Priya"),
      record("contact", "c1", "Priya"),
    ];
    const runtime = {
      spine: {
        listLinks: async ({ entityId }: { entityId: string }) => {
          calls.push(`links:${entityId}`);
          return linkRows[entityId] ?? [];
        },
        getEntities: async ({ refs }: { refs: EntityRef[] }) => {
          calls.push(`entities:${refs.length}`);
          return records.filter((r) => refs.some((x) => x.type === r.type && x.id === r.id));
        },
      },
    } as unknown as ModuoRuntime;
    const ids = ["e1", "e2"];
    const { result } = renderHook(() =>
      useDayPrepLinks(runtime, "ws1", ids, (taskId) => taskId === "t-done"),
    );
    await waitFor(() => expect(result.current.get("e1")).toBeTruthy());
    expect(result.current.get("e1")).toEqual({
      notes: [{ id: "n1", title: "Board prep" }],
      tasks: [{ id: "t2", title: "Send the deck to Priya", done: false }],
    });
    expect(result.current.get("e2")).toEqual({ notes: [], tasks: [] });
    expect(calls.filter((c) => c.startsWith("links:")).sort()).toEqual(["links:e1", "links:e2"]);
    expect(calls.filter((c) => c.startsWith("entities:"))).toEqual(["entities:2"]);
  });
});

function link(id: string, eventId: string, type: string, otherId: string): EntityLink {
  return {
    id,
    workspaceId: "ws1",
    sourceType: "event",
    sourceId: eventId,
    targetType: type,
    targetId: otherId,
    relationKind: "references",
    origin: "manual",
    createdBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
  } as EntityLink;
}

function record(type: string, id: string, label: string): EntityRecord {
  return { workspaceId: "ws1", type, id, label, icon: null, deletedAt: null } as EntityRecord;
}
