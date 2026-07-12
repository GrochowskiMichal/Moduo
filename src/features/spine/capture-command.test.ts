// DF-20 — capture routing + write path. Proves the prefix parser routes to the
// right module (default Task, `/note` `/event` `/contact`, `/task` alias, unknown
// slash stays a Task) and that createCapturedEntity calls each module's own
// create op with a date-stripped title / correct event times.

import { describe, expect, it, vi } from "vitest";

import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  CAPTURE_ROUTES,
  canWriteRoute,
  createCapturedEntity,
  isPermissionError,
  parseCaptureCommand,
} from "./capture-command";

const routeFor = (target: string) => CAPTURE_ROUTES.find((r) => r.target === target)!;

describe("parseCaptureCommand", () => {
  it("defaults a plain line to the Task route with the whole line as body", () => {
    const { route, body } = parseCaptureCommand("buy milk");
    expect(route.target).toBe("task");
    expect(body).toBe("buy milk");
  });

  it.each([
    ["/note", "note"],
    ["/event", "event"],
    ["/contact", "contact"],
    ["/task", "task"],
  ] as const)("routes %s to the %s module and strips the prefix", (prefix, target) => {
    const { route, body } = parseCaptureCommand(`${prefix} Design review`);
    expect(route.target).toBe(target);
    expect(body).toBe("Design review");
  });

  it("is case-insensitive on the prefix", () => {
    expect(parseCaptureCommand("/NOTE hello").route.target).toBe("note");
    expect(parseCaptureCommand("/Event standup").route.target).toBe("event");
  });

  it("accepts a bare prefix with no body", () => {
    const { route, body } = parseCaptureCommand("/note");
    expect(route.target).toBe("note");
    expect(body).toBe("");
  });

  it("treats an unknown slash word as a Task carrying the literal text", () => {
    const { route, body } = parseCaptureCommand("/groceries eggs");
    expect(route.target).toBe("task");
    expect(body).toBe("/groceries eggs");
  });

  it("only honors the prefix at the very start (mid-line slash is literal)", () => {
    const { route, body } = parseCaptureCommand("call Sam /note later");
    expect(route.target).toBe("task");
    expect(body).toBe("call Sam /note later");
  });

  it("ignores leading whitespace before the prefix", () => {
    expect(parseCaptureCommand("   /contact Ada").route.target).toBe("contact");
  });

  it("does not treat a longer word starting with a prefix as that prefix", () => {
    // "/notebook" is not "/note" — no whitespace terminator, so it stays a Task.
    const { route, body } = parseCaptureCommand("/notebook shopping");
    expect(route.target).toBe("task");
    expect(body).toBe("/notebook shopping");
  });
});

// ── createCapturedEntity ──────────────────────────────────────────────────────

const REF = new Date("2026-07-11T09:00:00"); // Saturday, local

function mockRuntime() {
  const seedInbox = vi.fn().mockResolvedValue({ id: "inbox-1" });
  const list = vi.fn().mockResolvedValue({ tasks: [] });
  const upsertTask = vi.fn().mockImplementation(async (t: unknown) => t);
  const noteCreate = vi.fn().mockResolvedValue({ id: "n1", title: "Design review" });
  const createEvent = vi.fn().mockResolvedValue({ id: "e1" });
  const createContact = vi.fn().mockResolvedValue({ id: "c1", name: "Ada Lovelace" });
  const runtime = {
    tasks: { seedInbox, list, upsertTask },
    notesV2: { create: noteCreate },
    calendar: { createEvent },
    contacts: { createContact },
  } as unknown as ModuoRuntime;
  return { runtime, seedInbox, list, upsertTask, noteCreate, createEvent, createContact };
}

describe("createCapturedEntity", () => {
  it("captures a task into the Inbox via seedInbox + upsertTask, date stripped", async () => {
    const m = mockRuntime();
    const result = await createCapturedEntity({
      runtime: m.runtime,
      workspaceId: "w1",
      target: "task",
      body: "submit report tomorrow 5pm",
      now: REF,
    });
    expect(m.seedInbox).toHaveBeenCalledWith("w1");
    expect(m.upsertTask).toHaveBeenCalledTimes(1);
    const task = m.upsertTask.mock.calls[0][0];
    expect(task.bucketId).toBe("inbox-1");
    expect(task.title).toBe("submit report"); // "tomorrow 5pm" parsed out
    expect(task.scheduledAt).toBeTruthy(); // a clock time became a scheduled time
    expect(result.openTo).toBe("/tasks");
  });

  it("captures a note through notesV2.create", async () => {
    const m = mockRuntime();
    const result = await createCapturedEntity({
      runtime: m.runtime,
      workspaceId: "w1",
      target: "note",
      body: "Design review",
      now: REF,
    });
    expect(m.noteCreate).toHaveBeenCalledWith({ workspaceId: "w1", title: "Design review" });
    expect(result.target).toBe("note");
    expect(result.openTo).toBe("/notes");
  });

  it("captures a contact through contacts.createContact", async () => {
    const m = mockRuntime();
    const result = await createCapturedEntity({
      runtime: m.runtime,
      workspaceId: "w1",
      target: "contact",
      body: "Ada Lovelace",
      now: REF,
    });
    expect(m.createContact).toHaveBeenCalledWith({ workspaceId: "w1", name: "Ada Lovelace" });
    expect(result.openTo).toBe("/contacts");
  });

  it("captures a timed event (60-min block) when a clock time parses", async () => {
    const m = mockRuntime();
    await createCapturedEntity({
      runtime: m.runtime,
      workspaceId: "w1",
      target: "event",
      body: "lunch with Sam at 1pm",
      now: REF,
    });
    const arg = m.createEvent.mock.calls[0][0];
    expect(arg.title).toBe("lunch with Sam");
    expect(arg.allDay).toBe(false);
    const span = new Date(arg.endsAt).getTime() - new Date(arg.startsAt).getTime();
    expect(span).toBe(60 * 60_000);
    expect(new Date(arg.startsAt).getHours()).toBe(13);
  });

  it("captures an all-day event when only a date parses", async () => {
    const m = mockRuntime();
    await createCapturedEntity({
      runtime: m.runtime,
      workspaceId: "w1",
      target: "event",
      body: "conference friday",
      now: REF,
    });
    const arg = m.createEvent.mock.calls[0][0];
    expect(arg.allDay).toBe(true);
    // local-midnight → next local-midnight (a whole day span)
    const span = new Date(arg.endsAt).getTime() - new Date(arg.startsAt).getTime();
    expect(span).toBe(24 * 60 * 60_000);
  });

  it("defaults an undated event to a next-hour 60-min block", async () => {
    const m = mockRuntime();
    await createCapturedEntity({
      runtime: m.runtime,
      workspaceId: "w1",
      target: "event",
      body: "sync",
      now: REF, // 09:00 → next hour 10:00
    });
    const arg = m.createEvent.mock.calls[0][0];
    expect(arg.allDay).toBe(false);
    expect(new Date(arg.startsAt).getHours()).toBe(10);
    expect(new Date(arg.startsAt).getMinutes()).toBe(0);
  });
});

describe("canWriteRoute", () => {
  it("lets an editor create through every route", () => {
    const perms = { notes: "edit", tasks: "edit" };
    for (const route of CAPTURE_ROUTES) expect(canWriteRoute(route, perms)).toBe(true);
  });

  it("blocks a task/event capture for a view-only Tasks member", () => {
    const perms = { notes: "edit", tasks: "view" };
    expect(canWriteRoute(routeFor("task"), perms)).toBe(false);
    expect(canWriteRoute(routeFor("event"), perms)).toBe(false); // calendar rides the Tasks lane
    expect(canWriteRoute(routeFor("note"), perms)).toBe(true);
  });

  it("blocks a note capture for a view-only Notes member", () => {
    const perms = { notes: "view", tasks: "edit" };
    expect(canWriteRoute(routeFor("note"), perms)).toBe(false);
    expect(canWriteRoute(routeFor("task"), perms)).toBe(true);
  });

  it("always allows contacts (ungated at alpha — server op guards)", () => {
    expect(canWriteRoute(routeFor("contact"), { notes: "none", tasks: "none" })).toBe(true);
  });

  it("accepts admin as writable", () => {
    expect(canWriteRoute(routeFor("task"), { notes: "none", tasks: "admin" })).toBe(true);
  });
});

describe("isPermissionError", () => {
  // Verbatim RAISE messages from the module ops (supabase/migrations).
  it.each([
    "You don't have edit access to Contacts in this workspace.",
    "You do not have edit access to notes in this workspace.",
    "You don't have edit access to Calendar in this workspace.",
    'new row violates row-level security policy for table "tasks"',
    "permission denied for table contacts",
  ])("detects a permission denial: %s", (msg) => {
    expect(isPermissionError(msg)).toBe(true);
  });

  it("does not treat a generic/network error as a permission denial", () => {
    expect(isPermissionError("Failed to fetch")).toBe(false);
    expect(isPermissionError("A name is required.")).toBe(false);
    expect(isPermissionError("")).toBe(false);
    expect(isPermissionError(null)).toBe(false);
    expect(isPermissionError(undefined)).toBe(false);
  });
});

describe("CAPTURE_ROUTES", () => {
  it("has Task first (the default) and one route per capture target", () => {
    expect(CAPTURE_ROUTES[0].target).toBe("task");
    expect(CAPTURE_ROUTES.map((r) => r.target)).toEqual(["task", "note", "event", "contact"]);
  });
});
