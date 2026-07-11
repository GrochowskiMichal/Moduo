// FX-1 AC1 — the entity-open route map: each entity type resolves to the right
// page (contacts with URL selection params), unknown types resolve to null so
// the listener can no-op with a quiet toast instead of crashing.

import { describe, expect, it } from "vitest";
import { entityOpenTarget, markEntityOpenIntent, takeEntityOpenIntent } from "./entity-open";

describe("entityOpenTarget", () => {
  it("routes a contact to /contacts with type+id selection params", () => {
    expect(entityOpenTarget("contact", "c1")).toEqual({
      to: "/contacts",
      search: { type: "contact", id: "c1" },
    });
  });

  it("routes a company to /contacts with type+id selection params", () => {
    expect(entityOpenTarget("company", "co1")).toEqual({
      to: "/contacts",
      search: { type: "company", id: "co1" },
    });
  });

  it("routes tasks and projects to /tasks with URL selection (DF-1)", () => {
    expect(entityOpenTarget("task", "t1")).toEqual({ to: "/tasks", search: { id: "t1" } });
    expect(entityOpenTarget("project", "p1")).toEqual({ to: "/tasks", search: { id: "p1" } });
  });

  it("routes a note to /notes with URL selection (NO-3)", () => {
    expect(entityOpenTarget("note", "n1")).toEqual({ to: "/notes", search: { id: "n1" } });
  });

  it("routes emails to their module page", () => {
    expect(entityOpenTarget("email", "e1")).toEqual({ to: "/email" });
    expect(entityOpenTarget("email_thread", "r1")).toEqual({ to: "/email" });
  });

  it("routes an id-less email open to the inbox (the widget's per-account rows, EM-11)", () => {
    // Email has no URL thread-selection yet, so an id-less 'open my inbox' is
    // valid — it must NOT be swallowed by the id guard.
    expect(entityOpenTarget("email", "")).toEqual({ to: "/email" });
  });

  it("routes an event to the calendar page (CAL-7)", () => {
    expect(entityOpenTarget("event", "ev1")).toEqual({ to: "/calendar" });
  });

  it("returns null for types with no page yet (payment, unknown)", () => {
    expect(entityOpenTarget("payment", "x")).toBeNull();
    expect(entityOpenTarget("invoice", "x")).toBeNull();
    expect(entityOpenTarget("", "x")).toBeNull();
  });

  it("returns null when the id is missing", () => {
    expect(entityOpenTarget("contact", "")).toBeNull();
  });
});

describe("entity-open intent (DF-1)", () => {
  it("is one-shot: a marked id matches once, then the mark is spent", () => {
    markEntityOpenIntent("t1");
    expect(takeEntityOpenIntent("t1")).toBe(true);
    expect(takeEntityOpenIntent("t1")).toBe(false);
  });

  it("clears a stale mark even on a mismatched take", () => {
    markEntityOpenIntent("t1");
    expect(takeEntityOpenIntent("other")).toBe(false);
    expect(takeEntityOpenIntent("t1")).toBe(false);
  });

  it("never matches with no mark, and an empty mark is a no-op", () => {
    expect(takeEntityOpenIntent("t1")).toBe(false);
    markEntityOpenIntent("");
    expect(takeEntityOpenIntent("")).toBe(false);
  });
});
