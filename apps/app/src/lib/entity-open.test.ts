// FX-1 AC1 — the entity-open route map: each entity type resolves to the right
// page (contacts with URL selection params), unknown types resolve to null so
// the listener can no-op with a quiet toast instead of crashing.

import { describe, expect, it } from "@rstest/core";

import {
  entityOpenTarget,
  markEntityOpenIntent,
  recentRefFor,
  takeEntityOpenIntent,
} from "./entity-open";

describe("entityOpenTarget", () => {
  it("routes a contact to /contacts with type+id selection params", () => {
    expect(entityOpenTarget("contact", "c1")).toEqual({
      to: "/contacts",
      search: { type: "contact", id: "c1" },
      intentId: "c1",
    });
  });

  it("routes a company to /contacts with type+id selection params", () => {
    expect(entityOpenTarget("company", "co1")).toEqual({
      to: "/contacts",
      search: { type: "company", id: "co1" },
      intentId: "co1",
    });
  });

  it("routes tasks and projects to /tasks with URL selection (DF-1)", () => {
    expect(entityOpenTarget("task", "t1")).toEqual({
      to: "/tasks",
      search: { id: "t1" },
      intentId: "t1",
    });
    expect(entityOpenTarget("project", "p1")).toEqual({
      to: "/tasks",
      search: { id: "p1" },
      intentId: "p1",
    });
  });

  it("routes a note to /notes with URL selection (NO-3)", () => {
    expect(entityOpenTarget("note", "n1")).toEqual({
      to: "/notes",
      search: { id: "n1" },
      intentId: "n1",
    });
  });

  it("routes an email thread to /email with a ?thread= deep link (DF-2)", () => {
    expect(entityOpenTarget("email", "e1")).toEqual({
      to: "/email",
      search: { thread: "e1" },
      intentId: "e1",
    });
    expect(entityOpenTarget("email_thread", "r1")).toEqual({
      to: "/email",
      search: { thread: "r1" },
      intentId: "r1",
    });
  });

  it("routes an id-less email open to the inbox (the widget's per-account rows, EM-11)", () => {
    // An id-less 'open my inbox' is valid — it must NOT be swallowed by the id
    // guard, and carries no thread selection.
    expect(entityOpenTarget("email", "")).toEqual({ to: "/email" });
    expect(entityOpenTarget("email_thread", "")).toEqual({ to: "/email" });
  });

  it("routes an event to /calendar with a ?event= deep link (DF-2)", () => {
    expect(entityOpenTarget("event", "ev1")).toEqual({
      to: "/calendar",
      search: { event: "ev1" },
      intentId: "ev1",
    });
  });

  it("lands a chat notice on its message and opens its chain (CV-3, AC1.6)", () => {
    // A conversation alone opens it.
    expect(entityOpenTarget("chat_channel", "c1")).toEqual({
      to: "/chat",
      search: { c: "c1" },
      intentId: "c1",
    });
    // A message in it: the stream loads a window around it.
    expect(entityOpenTarget("chat_channel", "c1", { messageId: "m1" })).toEqual({
      to: "/chat",
      search: { c: "c1", m: "m1" },
      intentId: "c1",
    });
    // A reply: its chain opens beside it.
    expect(entityOpenTarget("chat_channel", "c1", { messageId: "m2", chainId: "r1" })).toEqual({
      to: "/chat",
      search: { c: "c1", m: "m2", t: "r1" },
      intentId: "c1",
    });
    // A chain without a message names nothing to land on.
    expect(entityOpenTarget("chat_channel", "c1", { chainId: "r1" })?.search).toEqual({ c: "c1" });
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

// GS-8 (Q12, Q19): the app records your open of an item it can open, under
// search_all's type names; an id-less open, a module's own page or a settings
// section is not an item.
describe("recentRefFor", () => {
  it("names the item an open lands on", () => {
    expect(recentRefFor({ type: "note", id: "n1" })).toEqual({ type: "note", id: "n1" });
    expect(recentRefFor({ type: "task", id: "t1" })).toEqual({ type: "task", id: "t1" });
    expect(recentRefFor({ type: "contact", id: "c1" })).toEqual({ type: "contact", id: "c1" });
    expect(recentRefFor({ type: "event", id: "e1" })).toEqual({ type: "event", id: "e1" });
  });

  it("uses search_all's names: a project is a bucket, an email an email_thread", () => {
    expect(recentRefFor({ type: "project", id: "p1" })).toEqual({ type: "bucket", id: "p1" });
    expect(recentRefFor({ type: "email", id: "m1" })).toEqual({ type: "email_thread", id: "m1" });
  });

  it("records nothing that isn't an item", () => {
    expect(recentRefFor({ type: "note" })).toBeNull();
    expect(recentRefFor({ type: "email" })).toBeNull();
    expect(recentRefFor({ type: "settings", id: "storage" })).toBeNull();
    expect(recentRefFor({ to: "/tasks" })).toBeNull();
    expect(recentRefFor({ type: "wat", id: "x" })).toBeNull();
    expect(recentRefFor(null)).toBeNull();
  });
});
