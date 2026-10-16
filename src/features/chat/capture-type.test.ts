// CV-10 · the Message capture's picker and body, and "Became a task" (AC9.5, AC9.6).

import { describe, expect, it } from "@rstest/core";

import { messageBody, messageDestinations } from "./capture-type";
import type { ChatChannel, ChatPerson } from "./model";
import { becameLabel, groupMadeFrom } from "./stream/made-from";

function channel(over: Partial<ChatChannel>): ChatChannel {
  return {
    id: "c",
    workspaceId: "w",
    kind: "channel",
    name: "general",
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    archivedAt: null,
    lastMessageAt: null,
    ...over,
  };
}
const person = (userId: string, name: string): ChatPerson => ({
  userId,
  name,
  avatarUrl: null,
  role: "member",
});

describe("the Message capture's picker", () => {
  const channels = [
    channel({ id: "old", name: "general", lastMessageAt: "2026-10-02T00:00:00Z" }),
    channel({ id: "acme", name: "acme", lastMessageAt: "2026-10-12T00:00:00Z" }),
    channel({ id: "notin", name: "secret", isPrivate: true }),
    channel({
      id: "dm",
      kind: "dm",
      name: null,
      dmKey: "me,anna",
      lastMessageAt: "2026-10-10T00:00:00Z",
    }),
  ];
  const people = [person("me", "Me"), person("anna", "Anna"), person("bob", "Bob")];
  const mine = new Set(["old", "acme"]);

  it("recent conversations first, then people with no direct message yet", () => {
    const list = messageDestinations(channels, people, "me", "", mine);
    expect(list.map((d) => (d.kind === "person" ? `@${d.person.name}` : d.title))).toEqual([
      "acme",
      "Anna",
      "general",
      "@Bob",
    ]);
  });

  it("filters by name", () => {
    const list = messageDestinations(channels, people, "me", "bo", mine);
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe("person");
  });
});

describe("the Message capture's body", () => {
  it("the words, then the From: item alone on its line (a card)", () => {
    expect(
      messageBody("Can you look?", {
        type: "email_thread",
        id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      }),
    ).toBe("Can you look?\nmoduo://email_thread/0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(messageBody("  ", null)).toBe("");
  });
});

describe("Became a task", () => {
  it("one line per message, one chip per item, named by kind", () => {
    const grouped = groupMadeFrom([
      { messageId: "m", type: "task", id: "t1", createdAt: "a" },
      { messageId: "m", type: "task", id: "t1", createdAt: "b" },
      { messageId: "m", type: "task", id: "t2", createdAt: "c" },
    ]);
    expect(grouped.get("m")).toEqual([
      { type: "task", id: "t1" },
      { type: "task", id: "t2" },
    ]);
    expect(becameLabel([{ type: "task", id: "t1" }])).toBe("Became a task");
    expect(becameLabel([{ type: "event", id: "e" }])).toBe("Became an event");
    expect(
      becameLabel([
        { type: "task", id: "t" },
        { type: "note", id: "n" },
      ]),
    ).toBe("Became");
  });
});
