// DF-2 — the /calendar deep-link search: validate `?event=` and resolve an
// inbound event id to a navigate target (or `none` for stale/unknown ids).

import { describe, expect, it } from "vitest";
import { resolveCalendarDeepLink, validateCalendarSearch } from "./search";

const ev = (id: string, startsAt: string) => ({ id, startsAt }) as { id: string; startsAt: string };

describe("validateCalendarSearch", () => {
  it("keeps a non-empty event id", () => {
    expect(validateCalendarSearch({ event: "ev1" })).toEqual({ event: "ev1" });
  });

  it("drops empty / non-string / missing event", () => {
    expect(validateCalendarSearch({ event: "" })).toEqual({});
    expect(validateCalendarSearch({ event: 42 })).toEqual({});
    expect(validateCalendarSearch({})).toEqual({});
  });
});

describe("resolveCalendarDeepLink", () => {
  it("resolves a known event to its id + series start", () => {
    const events = [ev("ev1", "2026-07-15T09:00:00.000Z"), ev("ev2", "2026-07-16T10:00:00.000Z")];
    expect(resolveCalendarDeepLink("ev2", { events })).toEqual({
      kind: "event",
      eventId: "ev2",
      startsAt: "2026-07-16T10:00:00.000Z",
    });
  });

  it("returns none for an unknown id", () => {
    expect(
      resolveCalendarDeepLink("nope", { events: [ev("ev1", "2026-07-15T09:00:00.000Z")] }),
    ).toEqual({
      kind: "none",
    });
  });

  it("returns none for an empty id or a startless event", () => {
    expect(
      resolveCalendarDeepLink("", { events: [ev("ev1", "2026-07-15T09:00:00.000Z")] }),
    ).toEqual({
      kind: "none",
    });
    expect(resolveCalendarDeepLink("ev1", { events: [ev("ev1", "")] })).toEqual({ kind: "none" });
  });
});
