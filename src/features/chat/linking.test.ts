// CV-13 · a channel's link: the picker's candidates as links, capture's
// destination, the team offer, and the item's conversation lines.

import { describe, expect, it } from "@rstest/core";

import {
  captureDestination,
  linkFromCandidate,
  linkNoun,
  linkReferenceType,
  teamOffer,
  teamOfferQuestion,
} from "./linking";
import { mapChannel } from "./mappers";
import { conversationLine, itemConversationLines } from "./mentioned-in";
import type { ChatItemConversation } from "./model";

const row = (over: Partial<ChatItemConversation>): ChatItemConversation => ({
  channelId: "c1",
  workspaceId: "w",
  channelKind: "channel",
  channelName: "acme",
  channelPrivate: false,
  relation: "conversation-of",
  since: "2026-10-12T10:00:00Z",
  unread: 0,
  archived: false,
  ...over,
});

describe("a picked candidate as a link", () => {
  it("takes projects, companies, contacts and teams, nothing else", () => {
    expect(
      linkFromCandidate({
        kind: "entity",
        ref: { type: "bucket", id: "b" },
        label: "Web",
        icon: null,
      }),
    ).toEqual({
      type: "bucket",
      id: "b",
    });
    expect(
      linkFromCandidate({
        kind: "entity",
        ref: { type: "project", id: "b" },
        label: "Web",
        icon: null,
      }),
    ).toEqual({
      type: "bucket",
      id: "b",
    });
    expect(
      linkFromCandidate({
        kind: "entity",
        ref: { type: "company", id: "c" },
        label: "Acme",
        icon: null,
      }),
    ).toEqual({
      type: "company",
      id: "c",
    });
    expect(linkFromCandidate({ kind: "team", teamId: "t", label: "Design", letters: "D" })).toEqual(
      { type: "team", id: "t" },
    );
    expect(
      linkFromCandidate({ kind: "entity", ref: { type: "task", id: "x" }, label: "T", icon: null }),
    ).toBeNull();
    expect(
      linkFromCandidate({ kind: "person", memberId: "u", label: "Sofia", icon: null }),
    ).toBeNull();
  });

  it("names the kind and the reference type", () => {
    expect(linkNoun({ type: "bucket", id: "b" })).toBe("project");
    expect(linkNoun({ type: "contact", id: "c" })).toBe("client");
    expect(linkNoun({ type: "team", id: "t" })).toBe("team");
    expect(linkReferenceType({ type: "company", id: "c" })).toBe("company");
    expect(linkReferenceType({ type: "team", id: "t" })).toBeNull();
  });
});

describe("capture's destination from a linked channel", () => {
  it("is the linked project only when you may add to it", () => {
    const linked = { link: { type: "bucket" as const, id: "b" } };
    expect(captureDestination(linked, true)).toEqual({ projectId: "b" });
    expect(captureDestination(linked, false)).toBeUndefined();
    expect(captureDestination({ link: { type: "company", id: "c" } }, true)).toBeUndefined();
    expect(captureDestination({ link: null }, true)).toBeUndefined();
    expect(captureDestination(undefined, true)).toBeUndefined();
  });
});

describe("the team offer", () => {
  it("offers the team's people not already in, once each", () => {
    expect(teamOffer(["a", "b", "b", "c"], new Set(["a"]))).toEqual(["b", "c"]);
    expect(teamOffer(["a"], new Set(["a"]))).toEqual([]);
    expect(teamOfferQuestion(4)).toBe("Add the team's 4 people?");
    expect(teamOfferQuestion(1)).toBe("Add the team's 1 person?");
  });
});

describe("a channel row's link", () => {
  const base = { id: "c", workspace_id: "w", kind: "channel", name: "acme" };
  it("maps both halves, or none", () => {
    expect(mapChannel({ ...base, linked_type: "bucket", linked_id: "b" })?.link).toEqual({
      type: "bucket",
      id: "b",
    });
    expect(mapChannel({ ...base, linked_type: null, linked_id: null })?.link).toBeNull();
    expect(mapChannel({ ...base, linked_type: "note", linked_id: "n" })?.link).toBeNull();
    expect(mapChannel({ ...base, linked_type: "bucket" })?.link).toBeNull();
  });
});

describe("an item's conversation lines", () => {
  it('reads "Conversation: Acme · 3 new"', () => {
    expect(conversationLine(row({ unread: 3 }))).toBe("Conversation: acme · 3 new");
    expect(conversationLine(row({ unread: 0 }))).toBe("Conversation: acme");
    expect(conversationLine(row({ unread: 2, archived: true }))).toBe(
      "Conversation: acme · archived",
    );
  });

  it("puts linked conversations first and drops their Mentioned in line", () => {
    const lines = itemConversationLines([
      row({ channelId: "m1", relation: "mentions" }),
      row({ channelId: "c1", relation: "mentions" }),
      row({ channelId: "c1", relation: "conversation-of" }),
    ]);
    expect(lines.linked.map((r) => r.channelId)).toEqual(["c1"]);
    expect(lines.mentioned.map((r) => r.channelId)).toEqual(["m1"]);
  });
});
