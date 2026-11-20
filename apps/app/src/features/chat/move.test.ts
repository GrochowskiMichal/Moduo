// Move to… (CV-16): the places a selection can go, the audience warning's
// words, the op's answer and the two event lines' words.

import { describe, expect, it } from "@rstest/core";

import { audienceWarning, moveTargets } from "./dialogs/move-dialog";
import { parseMoveAnswer } from "./mappers";
import type { ChatChannel, ChatMessage, ChatPerson } from "./model";
import { eventConversationId, eventLineText } from "./stream/rows";

const ME = "me";
const C1 = "11111111-1111-4111-8111-111111111111";

function channel(id: string, extra: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id,
    workspaceId: "ws",
    kind: "channel",
    name: id,
    topic: "",
    isPrivate: false,
    dmKey: null,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    archivedAt: null,
    lastMessageAt: null,
    ...extra,
  };
}

const people: ChatPerson[] = [
  { userId: ME, name: "Maciej" } as ChatPerson,
  { userId: "anna", name: "Anna" } as ChatPerson,
];

function event(type: string, extra: Record<string, unknown>): ChatMessage {
  return {
    id: "e",
    kind: "event",
    event: { type, ...extra },
    createdAt: "2026-10-16T10:00:00Z",
  } as unknown as ChatMessage;
}

describe("moveTargets", () => {
  it("lists the conversations you're in, newest first, never this one or an archived one", () => {
    const chans = [
      channel("here", { lastMessageAt: "2026-10-16T09:00:00Z" }),
      channel("founders", { isPrivate: true, lastMessageAt: "2026-10-16T08:00:00Z" }),
      channel("general", { lastMessageAt: "2026-10-16T10:00:00Z" }),
      channel("old", { archivedAt: "2026-10-01T00:00:00Z" }),
      channel("notin"),
      channel("dm", { kind: "dm", name: null, dmKey: `${ME},anna` }),
    ];
    const mine = new Set(["here", "founders", "general", "old"]);
    const out = moveTargets(chans, people, ME, "here", mine, "");
    expect(out.map((t) => t.channel.id)).toEqual(["general", "founders", "dm"]);
    expect(out.find((t) => t.channel.id === "dm")?.title).toBe("Anna");
    expect(moveTargets(chans, people, ME, "here", mine, "foun").map((t) => t.channel.id)).toEqual([
      "founders",
    ]);
  });
});

describe("audienceWarning (CH55)", () => {
  it("counts the people who couldn't read the source", () => {
    expect(audienceWarning(2, "Founders")).toBe("2 people who aren't in Founders will see this");
    expect(audienceWarning(1, "Founders")).toBe("1 person who isn't in Founders will see this");
  });
});

describe("parseMoveAnswer", () => {
  it("reads the op's three answers and nothing else", () => {
    expect(parseMoveAnswer({ status: "confirm", newly: 3 })).toEqual({
      status: "confirm",
      newly: 3,
    });
    expect(
      parseMoveAnswer({ status: "moved", ids: ["a", "b", 1], from: "s", to: "t", out_id: "x" }),
    ).toEqual({ status: "moved", ids: ["a", "b"], from: "s", to: "t" });
    expect(parseMoveAnswer({ status: "undone", ids: [], from: "t", to: "s" })?.status).toBe(
      "undone",
    );
    expect(parseMoveAnswer({ status: "confirm" })).toBeNull();
    expect(parseMoveAnswer({ status: "moved", ids: [] })).toBeNull();
    expect(parseMoveAnswer(null)).toBeNull();
  });
});

describe("the move lines (§18)", () => {
  it("say who moved how many, and name the other conversation as a reference", () => {
    const out = event("moved_out", { ids: ["a", "b"], count: 2, to: `moduo://chat_channel/${C1}` });
    expect(eventLineText(out, "Anna")).toBe("Anna moved 2 messages to");
    expect(eventConversationId(out.event, "to")).toBe(C1);
    const inn = event("moved_in", { ids: ["a"], from: `moduo://chat_channel/${C1}` });
    expect(eventLineText(inn, "You")).toBe("You moved a message here from");
    expect(eventConversationId(inn.event, "from")).toBe(C1);
  });

  it("an unknown type or a malformed reference draws no words or chip", () => {
    expect(eventLineText(event("call_ended", {}), "Anna")).toBeNull();
    expect(eventConversationId({ type: "moved_in", from: "moduo://task/x" }, "from")).toBeNull();
  });
});
