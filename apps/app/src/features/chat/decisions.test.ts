// Decisions on an item (CV-14, §8): the line's lead and the server row's mapping.

import { describe, expect, it } from "@rstest/core";

import { decidedLead, decidedWhere } from "./decisions";
import { mapItemDecision } from "./mappers";

const dm = (withNames: string[]) => ({
  channelKind: "dm" as const,
  channelName: null,
  withNames,
});

describe("decisions on items", () => {
  it("says where it was decided: with the people of a direct message, in a channel", () => {
    expect(decidedWhere(dm(["Mike"]))).toBe("with Mike");
    expect(decidedWhere(dm(["Ana", "Mike"]))).toBe("with Ana and Mike");
    expect(decidedWhere(dm(["Ana", "Mike", "Jo"]))).toBe("with Ana, Mike and 1 other");
    expect(decidedWhere(dm(["Ana", "Mike", "Jo", "Li"]))).toBe("with Ana, Mike and 2 others");
    expect(decidedWhere(dm([]))).toBe("in a direct message");
    expect(decidedWhere({ channelKind: "channel", channelName: "acme", withNames: [] })).toBe(
      "in acme",
    );
  });

  it('reads "Decided with Mike · Oct 12"', () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(decidedLead({ ...dm(["Mike"]), decisionAt: "2026-10-12T12:00:00Z" }, now)).toBe(
      "Decided with Mike · Oct 12",
    );
  });

  it("maps the server's row and drops one without its ids", () => {
    const row = mapItemDecision({
      message_id: "m1",
      parent_id: "r1",
      channel_id: "c1",
      workspace_id: "w1",
      channel_kind: "dm",
      channel_name: null,
      with_names: ["Mike"],
      decision_at: "2026-10-12T12:00:00Z",
      excerpt: "we go with Stripe",
      created_at: "2026-10-12T11:00:00Z",
    });
    expect(row).toEqual({
      messageId: "m1",
      parentId: "r1",
      channelId: "c1",
      workspaceId: "w1",
      channelKind: "dm",
      channelName: null,
      withNames: ["Mike"],
      decisionAt: "2026-10-12T12:00:00Z",
      excerpt: "we go with Stripe",
      createdAt: "2026-10-12T11:00:00Z",
    });
    expect(mapItemDecision({ message_id: "m1" })).toBeNull();
  });
});
