// TV-U14 · the kept capture draft: one person, one workspace, ids only, and
// gone when someone signs out on the device or the account is deleted.

import { afterEach, describe, expect, it } from "@rstest/core";

import {
  type CaptureDraft,
  EMPTY_FIELDS,
  forgetCaptureDrafts,
  loadDraft,
  saveDraft,
} from "./capture-draft";

const SECRET = "Acquire Northwind quietly";

const draft = (over: Partial<CaptureDraft> = {}): CaptureDraft => ({
  segments: [
    { text: "Call " },
    { token: { kind: "thing", ref: { type: "task", id: "t-secret" }, label: SECRET } },
    { text: " with " },
    { token: { kind: "person", userId: "u-sam", label: "Sam Ortiz" } },
    { token: { kind: "team", teamId: "team-1", label: "Design", letters: "DS" } },
    { token: { kind: "tag", tagId: "tag-1", label: "client", color: "blue" } },
    { token: { kind: "tag", tagId: null, label: "brand-new", color: null } },
    { token: { kind: "due", day: "2026-10-14", label: "Oct 14" } },
  ],
  keep: ["Monday"],
  description: "My own words",
  subtasks: ["Book a room"],
  fields: { ...EMPTY_FIELDS, tags: [{ id: "tag-2", name: "Private tag name" }] },
  ...over,
});

afterEach(() => window.localStorage.clear());

describe("the capture draft", () => {
  it("belongs to one person in one workspace", () => {
    saveDraft("u1", "w1", draft());
    expect(loadDraft("u1", "w1")?.description).toBe("My own words");
    // A second person on this device never sees it, nor does the same person elsewhere.
    expect(loadDraft("u2", "w1")).toBeNull();
    expect(loadDraft("u1", "w2")).toBeNull();
  });

  it("keeps ids and the person's own words, never a linked item's or anyone's name", () => {
    saveDraft("u1", "w1", draft());
    const raw = Object.keys(window.localStorage)
      .map((k) => window.localStorage.getItem(k) ?? "")
      .join("");
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("Sam Ortiz");
    expect(raw).not.toContain("Design");
    expect(raw).not.toContain("client");
    expect(raw).not.toContain("Private tag name");
    // A new tag is the person's own word; dates are their settings.
    expect(raw).toContain("brand-new");
    expect(raw).toContain("2026-10-14");
    const back = loadDraft("u1", "w1");
    expect(back?.segments[1]).toEqual({
      token: { kind: "thing", ref: { type: "task", id: "t-secret" }, label: "" },
    });
  });

  it("is gone after a sign-out on this device (every person's)", () => {
    saveDraft("u1", "w1", draft());
    saveDraft("u2", "w1", draft());
    window.localStorage.setItem("unrelated", "stays");
    forgetCaptureDrafts();
    expect(loadDraft("u1", "w1")).toBeNull();
    expect(loadDraft("u2", "w1")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("stays");
  });

  it("a refused capture is kept apart, ids only, and goes on sign-out like the draft", () => {
    saveDraft("u1", "w1", draft({ pasted: "Line one\nLine two" }), "refused");
    expect(loadDraft("u1", "w1")).toBeNull();
    const kept = loadDraft("u1", "w1", "refused");
    expect(kept?.pasted).toBe("Line one\nLine two");
    const raw = Object.keys(window.localStorage)
      .map((k) => window.localStorage.getItem(k) ?? "")
      .join("");
    expect(raw).not.toContain(SECRET);
    expect(loadDraft("u2", "w1", "refused")).toBeNull();
    forgetCaptureDrafts();
    expect(loadDraft("u1", "w1", "refused")).toBeNull();
  });

  it("a deleted account's drafts go, and only theirs", () => {
    saveDraft("u1", "w1", draft());
    saveDraft("u2", "w1", draft());
    forgetCaptureDrafts("u1");
    expect(loadDraft("u1", "w1")).toBeNull();
    expect(loadDraft("u2", "w1")).not.toBeNull();
  });

  it("an empty capture keeps nothing", () => {
    saveDraft("u1", "w1", draft());
    saveDraft("u1", "w1", {
      segments: [],
      keep: [],
      description: "",
      subtasks: [],
      fields: EMPTY_FIELDS,
    });
    expect(loadDraft("u1", "w1")).toBeNull();
  });
});
