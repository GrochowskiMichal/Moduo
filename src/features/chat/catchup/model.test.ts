// Catch up's view model (CV-11, §9, frame 1).

import { describe, expect, it } from "@rstest/core";

import type { ChatCatchupItem, ChatPerson, ChatUnread } from "../model";
import { channel, ME, member, uuid, YOU } from "../store/testing";
import { buildCatchup, catchupWhy, flatRows, nextSelection, quietChannelsLine } from "./model";

const ACME = uuid(10);
const DM = uuid(11);
const channels = {
  [ACME]: channel(ACME, { name: "Acme rebrand" }),
  [DM]: channel(DM, { kind: "dm", name: null, dmKey: [ME, YOU].sort().join(",") }),
};
const people: Record<string, ChatPerson> = {
  [YOU]: { userId: YOU, name: "Sofia Ortiz", avatarUrl: null, role: "member" },
};
const personOf = (id: string) => people[id];

function item(
  n: number,
  channelId: string,
  reason: ChatCatchupItem["reason"],
  minute: number,
  extra: Partial<ChatCatchupItem> = {},
): ChatCatchupItem {
  const at = new Date(Date.UTC(2026, 9, 16, 9, minute)).toISOString();
  return {
    id: uuid(100 + n),
    channelId,
    messageId: uuid(200 + n),
    chainRootId: null,
    reason,
    actorId: null,
    createdAt: at,
    laterUntil: null,
    returnedAt: null,
    at,
    ...extra,
  };
}

const unread = (channelId: string, extra: Partial<ChatUnread> = {}): ChatUnread => ({
  channelId,
  unread: 0,
  mentions: 0,
  addressed: 0,
  catchup: 0,
  ...extra,
});

const build = (items: ChatCatchupItem[], order: "grouped" | "newest" = "grouped", u = {}) =>
  buildCatchup({
    items,
    channels,
    unread: u,
    selfId: ME,
    personOf,
    authorOf: () => "Sofia Ortiz",
    order,
  });

describe("Catch up's list (frame 1)", () => {
  it("groups by conversation, the newest group first, newest item first in each", () => {
    const groups = build([
      item(1, ACME, "mention", 41),
      item(2, DM, "dm", 43),
      item(3, ACME, "reply", 50),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Acme rebrand", "Sofia Ortiz"]);
    expect(groups[0]?.rows.map((r) => r.why)).toEqual([
      "replied in a chain you're in",
      "mentioned you",
    ]);
    expect(groups[1]?.rows[0]?.why).toBe("direct message");
  });

  it("newest first (a Display option) is one list across conversations", () => {
    const groups = build(
      [item(1, ACME, "mention", 41), item(2, DM, "dm", 43), item(3, ACME, "reply", 40)],
      "newest",
    );
    expect(groups).toHaveLength(1);
    expect(flatRows(groups).map((r) => r.item.id)).toEqual([uuid(102), uuid(101), uuid(103)]);
  });

  it("an item back from Later sorts on top by when it came back (`at`)", () => {
    const back = item(1, DM, "mention", 0, {
      returnedAt: "2026-10-16T12:00:00.000Z",
      at: "2026-10-16T12:00:00.000Z",
    });
    const groups = build([item(2, ACME, "mention", 30), back]);
    expect(groups[0]?.channelId).toBe(DM);
  });

  it("an Every-message conversation is one line: 'Acme · 12 new' (CH73, AC7.3)", () => {
    const groups = build([item(1, ACME, "every_message", 10)], "grouped", {
      [ACME]: unread(ACME, { unread: 12 }),
    });
    const row = groups[0]?.rows[0];
    expect(row?.why).toBe("Acme rebrand · 12 new");
    expect(row?.who).toBeNull();
  });

  it("says why each item is here", () => {
    const i = item(1, ACME, "mention", 0);
    expect(catchupWhy({ ...i, reason: "team_mention" }, "Acme", 0)).toBe("mentioned your team");
    expect(catchupWhy({ ...i, reason: "everyone" }, "Acme", 0)).toBe("mentioned everyone");
    expect(catchupWhy({ ...i, reason: "announcement" }, "Acme", 0)).toBe("posted an announcement");
    expect(catchupWhy({ ...i, reason: "reminder" }, "Acme", 0)).toBe("you asked to be reminded");
    expect(catchupWhy({ ...i, reason: "level_reset" }, "Acme", 0)).toBe(
      "Chat's defaults changed: Acme now notifies you for mentions and replies.",
    );
  });

  it("a quiet line names who did it and stays quiet", () => {
    const groups = build([item(1, ACME, "added", 0, { actorId: YOU, messageId: null })]);
    const row = groups[0]?.rows[0];
    expect(row?.quiet).toBe(true);
    expect(row?.who).toBe("Sofia Ortiz");
    expect(row?.why).toBe("added you to Acme rebrand");
  });

  it("300 items after a week away stay grouped (and quick)", () => {
    const items = Array.from({ length: 300 }, (_, n) =>
      item(n, n % 2 ? ACME : DM, n % 3 ? "mention" : "reply", n % 60),
    );
    const t0 = performance.now();
    const groups = build(items);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(groups).toHaveLength(2);
    expect(flatRows(groups)).toHaveLength(300);
  });
});

describe("selection after Done", () => {
  const rows = flatRows(
    build([item(1, ACME, "mention", 3), item(2, ACME, "mention", 2), item(3, ACME, "mention", 1)]),
  );
  it("moves to the next row, else the previous", () => {
    expect(nextSelection(rows, [uuid(101)], uuid(101))).toBe(uuid(102));
    expect(nextSelection(rows, [uuid(103)], uuid(103))).toBe(uuid(102));
    expect(nextSelection(rows, [uuid(101), uuid(102), uuid(103)], uuid(102))).toBeNull();
  });
});

describe("the zero state (§9)", () => {
  it("counts conversations with news you weren't asked about", () => {
    const mine = { [ACME]: member(ACME), [DM]: member(DM) };
    expect(quietChannelsLine({}, mine)).toBe("Nothing is waiting for you.");
    expect(
      quietChannelsLine(
        {
          [ACME]: unread(ACME, { unread: 4 }),
          [DM]: unread(DM, { unread: 2 }),
          [uuid(12)]: unread(uuid(12), { unread: 1 }),
        },
        { ...mine, [uuid(12)]: member(uuid(12)) },
      ),
    ).toBe(
      "Nothing is waiting for you. Three channels have messages you weren't asked about; they'll keep.",
    );
    expect(quietChannelsLine({ [ACME]: unread(ACME, { unread: 4, catchup: 1 }) }, mine)).toBe(
      "Nothing is waiting for you.",
    );
  });
});
