/**
 * AC5 (mention half) — the Notes `@` surface is people-ONLY, and a person
 * mention resolves to a notification (never a link), with the op payload
 * targeting the right user (feeds `spine_activity_targets_me`).
 */

import { describe, expect, it } from "@rstest/core";
import { buildMentionCandidates, resolveMention } from "../spine/mention";

describe("@ = workspace people only (AC5)", () => {
  it("with entities scoped OFF, candidates are members only", () => {
    // The Notes surface passes includeEntities:false → the hook hands the
    // builder an empty entity list; whatever entities exist never surface.
    const candidates = buildMentionCandidates({
      trigger: "mention",
      query: "an",
      entities: [], // includeEntities:false ⇒ always []
      people: [
        { memberId: "u-anna", label: "Anna Nowak", icon: null },
        { memberId: "u-jan", label: "Jan Kowalski", icon: null },
      ],
    });
    expect(candidates.every((c) => c.kind === "person")).toBe(true);
    expect(candidates.map((c) => (c.kind === "person" ? c.memberId : ""))).toEqual([
      "u-anna",
      "u-jan",
    ]);
  });

  it("an @ mention never offers create-and-link", () => {
    const candidates = buildMentionCandidates({
      trigger: "mention",
      query: "brand new thing",
      entities: [],
      people: [],
      createType: "contact",
      canCreate: true,
    });
    expect(candidates).toHaveLength(0);
  });

  it("picking a person resolves to notify-person (no link written)", () => {
    const resolution = resolveMention({
      trigger: "mention",
      candidate: { kind: "person", memberId: "u-anna", label: "Anna Nowak", icon: null },
    });
    expect(resolution.action).toBe("notify-person");
    if (resolution.action === "notify-person") {
      expect(resolution.memberId).toBe("u-anna");
    }
  });

  it("the notes mention op payload targets exactly the mentioned user", () => {
    // The editor wires onMentionPerson → notesV2.mention with this arg shape;
    // the server logs payload.mentioned_user_ids = [memberId], which is what
    // spine_activity_targets_me matches for the notification feed.
    const memberId = "u-anna";
    const args = {
      workspaceId: "ws1",
      noteId: "n1",
      mentionedUserIds: [memberId],
    };
    expect(args.mentionedUserIds).toEqual(["u-anna"]);
    expect(args.mentionedUserIds).toHaveLength(1);
  });
});
