import { describe, expect, test } from "@rstest/core";

import type { ChatSearchHit } from "../model";
import {
  appendPage,
  conditionsFromParams,
  dateRangeStart,
  findPosition,
  foldText,
  forgetSearches,
  hasSearchableWords,
  inFilterConversations,
  MARK_END,
  MARK_START,
  matchPeople,
  pageCursor,
  paramsFromConditions,
  reconcileTyped,
  rememberSearch,
  reopenSearch,
  searchQuery,
  splitSnippet,
  stepFind,
} from "./model";

const hit = (id: string, at: string): ChatSearchHit => ({
  messageId: id,
  channelId: "c",
  channelKind: "channel",
  channelName: "general",
  parentId: null,
  replyToId: null,
  authorId: "a",
  authorLabel: null,
  createdAt: at,
  snippet: "",
});

describe("chat search model (CV-19)", () => {
  test("a snippet splits into plain and marked runs, never HTML", () => {
    expect(splitSnippet(`Mamy ${MARK_START}żółw${MARK_END} w <b>ogrodzie</b>`)).toEqual([
      { text: "Mamy ", hit: false },
      { text: "żółw", hit: true },
      { text: " w <b>ogrodzie</b>", hit: false },
    ]);
    expect(splitSnippet("plain")).toEqual([{ text: "plain", hit: false }]);
    expect(splitSnippet(`${MARK_END}stray${MARK_START}`)).toEqual([{ text: "stray", hit: false }]);
    expect(splitSnippet("")).toEqual([]);
  });

  test("people are found by name, Polish without diacritics", () => {
    expect(foldText("Łukasz Żółw-Ćma")).toBe("lukasz zolw-cma");
    const people = [{ name: "Łucja Wróbel" }, { name: "Jan Zając" }, { name: "Anna" }];
    expect(matchPeople(people, "luc").map((p) => p.name)).toEqual(["Łucja Wróbel"]);
    expect(matchPeople(people, "zajac jan").map((p) => p.name)).toEqual(["Jan Zając"]);
    expect(matchPeople(people, "wrobel").map((p) => p.name)).toEqual(["Łucja Wróbel"]);
    expect(matchPeople(people, "nna")).toEqual([]);
    expect(matchPeople(people, "  ")).toEqual([]);
  });

  test("the FilterBar's conditions and the link agree both ways", () => {
    const params = { from: "u1", in: "c1", file: "1" as const, date: "7d" as const };
    const conditions = conditionsFromParams(params);
    expect(conditions.map((c) => c.dimension)).toEqual(["from", "in", "file", "date"]);
    expect(paramsFromConditions(conditions)).toEqual(params);
    expect(paramsFromConditions([])).toEqual({});
    expect(
      paramsFromConditions([{ dimension: "date", operator: "is", values: ["forever"] }]),
    ).toEqual({});
  });

  test("the server call carries the words and every filter", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(
      searchQuery("w", { q: "  zolw ", in: "c1", from: "u1", file: "1", date: "7d" }, now),
    ).toEqual({
      workspaceId: "w",
      query: "zolw",
      channelId: "c1",
      fromId: "u1",
      after: "2026-10-09T12:00:00.000Z",
      hasFile: true,
    });
    expect(searchQuery("w", {}, now)).toMatchObject({
      query: "",
      channelId: null,
      hasFile: false,
      after: null,
    });
    const today = new Date(dateRangeStart("today", now));
    expect(today.getHours()).toBe(0);
    expect(today.getMinutes()).toBe(0);
  });

  test("pages append older hits without repeats, from the last row's key", () => {
    const a = [hit("1", "2026-10-16T10:00:00Z"), hit("2", "2026-10-16T09:00:00Z")];
    const b = [hit("2", "2026-10-16T09:00:00Z"), hit("3", "2026-10-16T08:00:00Z")];
    expect(appendPage(a, b).map((h) => h.messageId)).toEqual(["1", "2", "3"]);
    expect(pageCursor(a)).toEqual({ createdAt: "2026-10-16T09:00:00Z", messageId: "2" });
    expect(pageCursor([])).toBeNull();
  });

  test("the find bar steps newest to oldest and says where it is", () => {
    expect(stepFind(-1, 3, "older")).toBe(0);
    expect(stepFind(0, 3, "older")).toBe(1);
    expect(stepFind(2, 3, "older")).toBe(2);
    expect(stepFind(1, 3, "newer")).toBe(0);
    expect(stepFind(0, 0, "older")).toBe(-1);
    expect(findPosition(1, 3, false)).toBe("2 of 3");
    expect(findPosition(0, 50, true)).toBe("1 of 50+");
    expect(findPosition(-1, 0, false)).toBe("No matches");
  });

  test("negated words only name nothing to find", () => {
    expect(hasSearchableWords("-standup")).toBe(false);
    expect(hasSearchableWords('-"stand up" -retro')).toBe(false);
    expect(hasSearchableWords("  -standup  or  -retro ")).toBe(false);
    // "or" first or last is the word itself, as websearch reads it.
    expect(hasSearchableWords("or")).toBe(true);
    expect(hasSearchableWords("OR")).toBe(true);
    expect(hasSearchableWords("  -standup  or  ")).toBe(true);
    expect(hasSearchableWords("or -standup")).toBe(true);
    expect(hasSearchableWords("-")).toBe(false);
    expect(hasSearchableWords("standup -retro")).toBe(true);
    expect(hasSearchableWords('"stand up"')).toBe(true);
    expect(hasSearchableWords("żółw")).toBe(true);
    expect(hasSearchableWords("e-mail")).toBe(true);
  });

  test("the In filter offers every conversation you can read, by title", () => {
    const channels = {
      s: { id: "s" }, // starred
      p: { id: "p" }, // public, not joined
      a: { id: "a" }, // archived
      d: { id: "d" }, // a direct message
    };
    const titles: Record<string, string> = {
      s: "design",
      p: "announcements",
      a: "old",
      d: "Łucja",
    };
    expect(inFilterConversations(channels, (id) => titles[id] ?? "")).toEqual([
      { id: "p", label: "announcements" },
      { id: "s", label: "design" },
      { id: "d", label: "Łucja" },
      { id: "a", label: "old" },
    ]);
  });

  test("typing keeps the box while the link echoes older words; a change from outside replaces it", () => {
    const pending = ["s", "st", "sta"];
    // The link catches up with "s" while "sta" is in the box: the box stays.
    expect(reconcileTyped("sta", "s", pending)).toBe("sta");
    expect(pending).toEqual(["st", "sta"]);
    expect(reconcileTyped("sta", "sta", pending)).toBe("sta");
    expect(pending).toEqual([]);
    // Typing "a", "ab", then back to "a": each echo is consumed in order, never a stale "ab".
    const again = ["a", "ab", "a"];
    expect(reconcileTyped("a", "a", again)).toBe("a");
    expect(reconcileTyped("a", "ab", again)).toBe("a");
    expect(reconcileTyped("a", "a", again)).toBe("a");
    expect(again).toEqual([]);
    // Back/forward or "See all" brings other words: they replace the box.
    expect(reconcileTyped("sta", "zolw", pending)).toBe("zolw");
  });

  test("the bottom bar's Search reopens with the last words and filters", () => {
    forgetSearches();
    expect(reopenSearch("u1", "w1", null)).toEqual({});
    rememberSearch("u1", "w1", { q: "żółw", from: "u1", date: "7d" });
    expect(reopenSearch("u1", "w1", null)).toEqual({ q: "żółw", from: "u1", date: "7d" });
    expect(reopenSearch("u1", "w2", null)).toEqual({});
    expect(reopenSearch("u1", "w1", { q: "now" })).toEqual({ q: "now" });
    expect(reopenSearch("u1", null, null)).toEqual({});
    expect(reopenSearch(null, "w1", null)).toEqual({});
  });

  test("a remembered search is the person's: someone else never reopens it, sign-out forgets it", () => {
    forgetSearches();
    rememberSearch("u1", "w1", { q: "salary" });
    // Another person in the same workspace on this device.
    expect(reopenSearch("u2", "w1", null)).toEqual({});
    // Sign out, sign back in as someone else (or the same person): nothing is remembered.
    forgetSearches();
    expect(reopenSearch("u2", "w1", null)).toEqual({});
    expect(reopenSearch("u1", "w1", null)).toEqual({});
  });
});
