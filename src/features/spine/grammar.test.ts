// RF-1 · the reference grammar (tasks-v3 §10–11, calls 33, 33a): one
// tokenizer for capture and prose. `@` mentions, `#` tags, `/` commands; the
// symbols only count at a word start, literal symbols stay text, and the date
// commands name a day.

import { describe, expect, it } from "@rstest/core";

import {
  dateCommandDay,
  findHandles,
  findSigilWords,
  looksLikeHandle,
  matchDateCommands,
  replaceSlashDates,
  takeSlashDates,
  triggerAt,
} from "./grammar";
import { handleFinishedAt } from "./references/handle-autolink-plugin";

const WED = new Date(2026, 9, 14, 10, 0, 0); // Wed Oct 14 2026

describe("triggerAt — what the caret sits after", () => {
  it("opens on a symbol at the start or after a space, with the word typed since", () => {
    expect(triggerAt("Call @an")).toEqual({ sigil: "@", start: 5, query: "an" });
    expect(triggerAt("#des")).toEqual({ sigil: "#", start: 0, query: "des" });
    expect(triggerAt("ship /tom")).toEqual({ sigil: "/", start: 5, query: "tom" });
  });

  it("lets a `/` command run to a few words (`/next we`), but no mention", () => {
    expect(triggerAt("due /next we")).toEqual({ sigil: "/", start: 4, query: "next we" });
    expect(triggerAt("/Order frames from printer")?.query).toBe("Order frames from printer");
    expect(triggerAt("/task Order frames from printer")?.query).toBe(
      "task Order frames from printer",
    );
    expect(triggerAt("/task Order frames from ")?.query).toBe("task Order frames from ");
    expect(triggerAt("/this is far too long now")).toBeNull();
    expect(triggerAt("ping @ann lee")).toBeNull();
  });

  it("keeps literal symbols as text: C#, and/or, 7/11, a / b, #123, an email address", () => {
    expect(triggerAt("a / b")).toBeNull();
    expect(triggerAt("Q3 / Q4")).toBeNull();
    expect(triggerAt("bug #123")).toBeNull();
    expect(triggerAt("ship /")).toEqual({ sigil: "/", start: 5, query: "" });
    expect(triggerAt("C#")).toBeNull();
    expect(triggerAt("and/or")).toBeNull();
    expect(triggerAt("on 7/11")).toBeNull();
    expect(triggerAt("mail ann@acme.com")).toBeNull();
  });

  it("only looks at the symbols asked for, and not past a line break", () => {
    expect(triggerAt("ship /tom", ["@"])).toBeNull();
    expect(triggerAt("@ann\nnext")).toBeNull();
  });
});

describe("findSigilWords — finished words (shared with search)", () => {
  it("finds finished `#` and `@` words, never one still being typed", () => {
    expect(findSigilWords("fix #design @ola now")).toEqual([
      { sigil: "#", word: "design", start: 4, end: 11 },
      { sigil: "@", word: "ola", start: 12, end: 16 },
    ]);
    expect(findSigilWords("fix #des")).toEqual([]);
    expect(findSigilWords("fix #des", { final: true }).map((w) => w.word)).toEqual(["des"]);
  });

  it("skips #123 and C#", () => {
    expect(findSigilWords("bug #123 in C# code ")).toEqual([]);
  });
});

describe("the date commands (33a)", () => {
  it("name a day: today, tomorrow, the coming Monday; /date asks", () => {
    expect(dateCommandDay("today", WED)).toBe("2026-10-14");
    expect(dateCommandDay("tomorrow", WED)).toBe("2026-10-15");
    expect(dateCommandDay("next-week", WED)).toBe("2026-10-19");
    expect(dateCommandDay("next-week", new Date(2026, 9, 19))).toBe("2026-10-26");
    expect(dateCommandDay("date", WED)).toBeNull();
  });

  it("list first in the `/` menu, filtered by what's typed", () => {
    expect(matchDateCommands("").map((c) => c.id)).toEqual([
      "today",
      "tomorrow",
      "next-week",
      "date",
    ]);
    expect(matchDateCommands("to").map((c) => c.id)).toEqual(["today", "tomorrow"]);
    expect(matchDateCommands("next w").map((c) => c.id)).toEqual(["next-week"]);
  });

  it("in a capture line set the day and leave the title", () => {
    expect(takeSlashDates("Send invoice /tomorrow", WED)).toEqual({
      text: "Send invoice",
      day: "2026-10-15",
    });
    expect(takeSlashDates("Plan /next week offsite", WED)).toEqual({
      text: "Plan offsite",
      day: "2026-10-19",
    });
    expect(takeSlashDates("and/or /todays", WED)).toEqual({ text: "and/or /todays", day: null });
  });

  it("in plain-text prose become whatever stores a date chip", () => {
    expect(replaceSlashDates("Ship /tomorrow, then rest", (d) => `[${d}]`, WED)).toBe(
      "Ship [2026-10-15], then rest",
    );
  });
});

describe("a typed handle links itself only right after you finish it", () => {
  it("finds the handle that ends one boundary character before the caret", () => {
    expect(handleFinishedAt("see MOD-142 ", 12, ["MOD"])).toEqual({
      handle: "MOD-142",
      start: 4,
      end: 11,
    });
    expect(handleFinishedAt("see MOD-142.", 12, ["MOD"])?.handle).toBe("MOD-142");
  });

  it("ignores handles elsewhere in the text, one still being typed, and other keys", () => {
    // Typing later in the paragraph never converts an older handle (or one ⌘Z restored).
    expect(handleFinishedAt("see MOD-142 and more", 20, ["MOD"])).toBeNull();
    expect(handleFinishedAt("see MOD-14", 10, ["MOD"])).toBeNull();
    expect(handleFinishedAt("UTF-8 ", 6, ["MOD"])).toBeNull();
  });
});

describe("task handles", () => {
  it("are found only for the workspace's own key, as whole words", () => {
    expect(findHandles("see MOD-142 and MOD-7.", ["MOD"]).map((h) => h.handle)).toEqual([
      "MOD-142",
      "MOD-7",
    ]);
    expect(findHandles("UTF-8 and COVID-19", ["MOD"])).toEqual([]);
    expect(findHandles("XMOD-142 MOD-142x", ["MOD"])).toEqual([]);
    expect(findHandles("MOD-142", [])).toEqual([]);
  });

  it("look like `KEY-number` in a deep link, any case", () => {
    expect(looksLikeHandle("MOD-142")).toBe(true);
    expect(looksLikeHandle("mod-142")).toBe(true);
    expect(looksLikeHandle("11111111-1111-4111-8111-111111111111")).toBe(false);
  });
});
