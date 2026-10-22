// Proves AC4 (the rendering half) — each spine op maps to a quiet, attributed
// sentence; unknown ops fall back to the op name; actor resolves to You / label
// / quiet fallback. Mirrors src/features/tasks/activity.test.ts.

import { describe, expect, it } from "@rstest/core";

import { dayShort, time24 } from "../calendar/booking/sentence";
import { appActorKind, spineActivityLine, spineActorName } from "./activity";

function entry(op: string, payload: Record<string, unknown> = {}) {
  return { op, payload };
}

describe("team notices (TV-D13)", () => {
  it("names the team, and how many were routed", () => {
    expect(spineActivityLine(entry("tasks.routed", { team_name: "Design", count: 1 }))).toBe(
      "routed this to Design",
    );
    expect(spineActivityLine(entry("tasks.routed", { team_name: "Design", count: 4 }))).toBe(
      "routed 4 tasks to Design",
    );
    expect(
      spineActivityLine(entry("tasks.routed", { team_name: "Design", count: 1, returned: true })),
    ).toBe("gave this back to Design");
  });

  it("checks back on a team task nobody took", () => {
    expect(
      spineActivityLine(
        entry("tasks.team_check_back", { team_name: "Design", reason: "unclaimed" }),
      ),
    ).toBe("checked: nobody in Design has taken this in 3 days");
    expect(
      spineActivityLine(entry("tasks.team_check_back", { team_name: "Design", reason: "due" })),
    ).toBe("checked: nobody in Design has taken this, and it's due tomorrow");
  });

  it("an @Team in a comment, and tasks back from someone who left", () => {
    expect(
      spineActivityLine(
        entry("comments.team_mention", { team_names: ["Design"], excerpt: "Ideas?" }),
      ),
    ).toBe("mentioned Design on this: “Ideas?”");
    expect(spineActivityLine(entry("tasks.handed_back", { name: "Sam", count: 2 }))).toBe(
      "removed Sam · 2 of your tasks are back in your Inbox",
    );
    expect(
      spineActivityLine(entry("tasks.handed_back", { name: "Sam", count: 1, left: true })),
    ).toBe("left the workspace · your task is back in your Inbox");
  });
});

describe("spineActorName", () => {
  const base = { actorType: "user" as const, actorId: "u1", actorLabel: "Maciej" };

  it("says You for the current user", () => {
    expect(spineActorName(base, "u1")).toBe("You");
  });

  it("uses the recorded label for someone else", () => {
    expect(spineActorName(base, "u2")).toBe("Maciej");
  });

  it("falls back quietly per actor type", () => {
    expect(spineActorName({ actorType: "user", actorId: null, actorLabel: null }, "u1")).toBe(
      "Someone",
    );
    expect(spineActorName({ actorType: "agent", actorId: null, actorLabel: null }, "u1")).toBe(
      "Moduo",
    );
    expect(spineActorName({ actorType: "api_key", actorId: null, actorLabel: null }, "u1")).toBe(
      "An API client",
    );
  });
});

describe("appActorKind (MOD-149)", () => {
  it("an API key's change is a connected app's, the plug", () => {
    expect(appActorKind({ actorType: "api_key" })).toBe("app");
  });

  it("an agent's change is Moduo's own (a catch-up, a waiting-on that came in), the Moduo mark", () => {
    expect(appActorKind({ actorType: "agent" })).toBe("moduo");
  });

  it("a person's, even unknown, is no app's", () => {
    expect(appActorKind({ actorType: "user" })).toBeNull();
    // A row with no type predates attribution: a person's, like `normalizeContentAuthorKind`.
    expect(appActorKind({ actorType: null })).toBeNull();
    expect(appActorKind({})).toBeNull();
  });
});

describe("spineActivityLine", () => {
  it("renders the task notifications (DF-9, TV-D1) in the card voice", () => {
    expect(spineActivityLine(entry("tasks.assigned"))).toBe("assigned this to you");
    expect(spineActivityLine(entry("tasks.completed"))).toBe("completed this");
  });

  it("renders a project delete's notice, naming the project only when it can (TV-U6)", () => {
    expect(spineActivityLine(entry("tasks.project_deleted", { title: "Acme", count: 3 }))).toBe(
      "deleted “Acme” · 3 of your tasks are in your Inbox",
    );
    expect(spineActivityLine(entry("tasks.project_deleted", { count: 1 }))).toBe(
      "deleted a project · your task is in your Inbox",
    );
  });

  it("renders link creation, by kind", () => {
    expect(spineActivityLine(entry("links.create", { relation_kind: "references" }))).toBe(
      "linked this",
    );
    expect(spineActivityLine(entry("links.create", { relation_kind: "follow-up" }))).toBe(
      "added a follow-up",
    );
    expect(spineActivityLine(entry("links.create", { relation_kind: "attachment" }))).toBe(
      "attached this",
    );
    expect(spineActivityLine(entry("links.create", { relation_kind: "blocks" }))).toBe(
      "linked this (blocks)",
    );
  });

  it("treats a contacts link the same way as a spine link", () => {
    expect(spineActivityLine(entry("contacts.link", { relation_kind: "follow-up" }))).toBe(
      "added a follow-up",
    );
  });

  it("renders re-typing and removing a link", () => {
    expect(spineActivityLine(entry("links.set_kind", { from: "references", to: "blocks" }))).toBe(
      "changed a link to blocks",
    );
    expect(spineActivityLine(entry("links.delete"))).toBe("removed a link");
    expect(spineActivityLine(entry("contacts.unlink"))).toBe("removed a link");
  });

  it("renders a comment with its excerpt", () => {
    expect(spineActivityLine(entry("comments.add", { excerpt: "ping me when ready" }))).toBe(
      "commented: “ping me when ready”",
    );
    expect(spineActivityLine(entry("comments.add"))).toBe("left a comment");
    expect(spineActivityLine(entry("notes.agent_edit"))).toBe("edited this note");
    // TV-U13: edits, deletes and their Undo read as words, never the op name.
    expect(spineActivityLine(entry("comments.edit", { excerpt: "now with @Mike" }))).toBe(
      "edited a comment: “now with @Mike”",
    );
    expect(spineActivityLine(entry("comments.delete"))).toBe("deleted a comment");
    expect(spineActivityLine(entry("comments.restore"))).toBe("brought back a comment");
  });

  it("renders a conversation's own changes, naming no one (CV-2b)", () => {
    expect(spineActivityLine(entry("chat.channel_create", { is_private: false }))).toBe(
      "created a channel",
    );
    expect(spineActivityLine(entry("chat.channel_rename"))).toBe("renamed this channel");
    expect(spineActivityLine(entry("chat.channel_topic"))).toBe("changed the topic");
    expect(spineActivityLine(entry("chat.join"))).toBe("joined this channel");
    expect(spineActivityLine(entry("chat.leave", { manager_id: "u1" }))).toBe("left this channel");
    expect(spineActivityLine(entry("chat.member_add", { user_ids: ["u1"] }))).toBe("added someone");
    expect(spineActivityLine(entry("chat.member_add", { user_ids: ["u1", "u2"] }))).toBe(
      "added 2 people",
    );
    expect(spineActivityLine(entry("chat.member_remove", { user_id: "u1" }))).toBe(
      "removed someone",
    );
    expect(
      spineActivityLine(entry("chat.channel_link", { linked_type: "bucket", linked_id: "b" })),
    ).toBe("linked this channel to a project");
    expect(
      spineActivityLine(entry("chat.channel_link", { linked_type: "company", linked_id: "c" })),
    ).toBe("linked this channel to a client");
    expect(
      spineActivityLine(entry("chat.channel_link", { linked_type: "team", linked_id: "t" })),
    ).toBe("linked this channel to a team");
    expect(
      spineActivityLine(entry("chat.channel_link", { linked_type: null, linked_id: null })),
    ).toBe("unlinked this channel");
  });

  it("renders a channel's lifecycle, naming no one (CV-15)", () => {
    expect(spineActivityLine(entry("chat.manager_add", { user_id: "u1" }))).toBe(
      "made someone a manager",
    );
    expect(spineActivityLine(entry("chat.manager_remove", { user_id: "u1" }))).toBe(
      "removed a manager",
    );
    expect(spineActivityLine(entry("chat.announcement_switch", { on: true }))).toBe(
      "made this an announcement channel",
    );
    expect(spineActivityLine(entry("chat.announcement_switch", { on: false }))).toBe(
      "let everyone post again",
    );
    expect(spineActivityLine(entry("chat.channel_private"))).toBe("made this channel private");
    expect(spineActivityLine(entry("chat.channel_delete"))).toBe("deleted this channel");
    expect(spineActivityLine(entry("chat.channel_restore"))).toBe("restored this channel");
  });

  it("renders a decision marked and taken back (CV-14)", () => {
    expect(spineActivityLine(entry("chat.decision", { message_id: "m1", on: true }))).toBe(
      "marked a decision",
    );
    expect(spineActivityLine(entry("chat.decision", { message_id: "m1", on: false }))).toBe(
      "took back a decision",
    );
  });

  it("renders a reply chain's wrap-up, reopen and undo (CV-12)", () => {
    const m = { message_id: "m1" };
    expect(spineActivityLine(entry("chat.wrap_up", { ...m, settled_id: "m2" }))).toBe(
      "wrapped up a reply chain",
    );
    expect(spineActivityLine(entry("chat.reopen", { ...m, undo: false }))).toBe(
      "reopened a reply chain",
    );
    expect(spineActivityLine(entry("chat.reopen", { ...m, undo: true }))).toBe("undid a wrap-up");
  });

  it("renders a move and its undo (CV-16)", () => {
    expect(spineActivityLine(entry("chat.move", { count: 1 }))).toBe("moved a message out");
    expect(spineActivityLine(entry("chat.move", { count: 3 }))).toBe("moved 3 messages out");
    expect(spineActivityLine(entry("chat.move", { count: 3, undo: true }))).toBe("undid a move");
  });

  it("renders a conversation's message changes for Details' history (CV-8b)", () => {
    const m = { message_id: "m1" };
    expect(spineActivityLine(entry("chat.pin", { ...m, pinned: true }))).toBe("pinned a message");
    expect(spineActivityLine(entry("chat.pin", { ...m, pinned: false }))).toBe(
      "unpinned a message",
    );
    expect(spineActivityLine(entry("chat.message_edit", m))).toBe("edited a message");
    expect(spineActivityLine(entry("chat.message_delete", m))).toBe("deleted a message");
    expect(spineActivityLine(entry("chat.message_restore", m))).toBe("brought back a message");
    expect(spineActivityLine(entry("chat.react", { ...m, key: "👍", on: true }))).toBe(
      "reacted to a message",
    );
    expect(spineActivityLine(entry("chat.react", { ...m, key: "👍", on: false }))).toBe(
      "took back a reaction",
    );
  });

  it("renders chat's bell rows by why they reached you (CV-5)", () => {
    const at = { channel_name: "plans", excerpt: "standup moved" };
    expect(spineActivityLine(entry("chat.mention", { ...at, reason: "person" }))).toBe(
      "mentioned you in #plans: “standup moved”",
    );
    expect(spineActivityLine(entry("chat.mention", { ...at, reason: "team" }))).toBe(
      "mentioned your team in #plans: “standup moved”",
    );
    expect(spineActivityLine(entry("chat.mention", { ...at, reason: "everyone" }))).toBe(
      "mentioned everyone in #plans: “standup moved”",
    );
    expect(spineActivityLine(entry("chat.reply", at))).toBe("replied in #plans: “standup moved”");
    expect(spineActivityLine(entry("chat.announcement", at))).toBe(
      "posted in #plans: “standup moved”",
    );
    // A v1 row has no reason: it reads as @you.
    expect(spineActivityLine(entry("chat.mention", { channel_name: "plans" }))).toBe(
      "mentioned you in #plans",
    );
    // The excerpt is the stored form: a person reads as a name, never as a URI.
    expect(
      spineActivityLine(
        entry("chat.mention", {
          channel_name: "plans",
          excerpt: "over to moduo://person/7b0c2b6e-0b1d-4c55-9a51-3f0e4f6b8a01",
        }),
        { referenceName: () => "Sofia" },
      ),
    ).toBe("mentioned you in #plans: “over to Sofia”");
  });

  it("draws a stored-form chat excerpt as words: no marks, people named (CV-11)", () => {
    const sofia = "moduo://person/7b0c2b6e-0b1d-4c55-9a51-3f0e4f6b8a01";
    const name = { referenceName: () => "Sofia" };
    expect(
      spineActivityLine(
        entry("chat.mention", {
          channel_name: "plans",
          format_version: 2,
          excerpt: `**Ship it**, ${sofia}\n- one *more* thing`,
        }),
        name,
      ),
    ).toBe("mentioned you in #plans: “Ship it, Sofia one more thing”");
    // The server cut the excerpt inside a reference: the half reference goes.
    expect(
      spineActivityLine(
        entry("chat.reply", {
          channel_name: "plans",
          format_version: 2,
          excerpt: "ask moduo://person/7b0c2b6e-0b1d",
        }),
        name,
      ),
    ).toBe("replied in #plans: “ask …”");
  });

  it("never lies by omission — unknown ops fall back to the op name", () => {
    expect(spineActivityLine(entry("links.future_op"))).toBe("links.future_op");
  });
});

describe("connected apps (MCPO-3)", () => {
  it("names the app's access, edit first, in the key card's module order", () => {
    expect(spineActivityLine(entry("api_keys.connected", { scopes: { tasks: "view" } }))).toBe(
      "connected to Moduo · View: Tasks",
    );
    expect(
      spineActivityLine(
        entry("api_keys.connected", {
          scopes: { links: "view", tasks: "edit", notes: "view", chat: "none" },
        }),
      ),
    ).toBe("connected to Moduo · Edit: Tasks · View: Notes, Links");
    expect(spineActivityLine(entry("api_keys.connected", { scopes: { tasks: "none" } }))).toBe(
      "connected to Moduo · no access",
    );
  });
});

describe("storage alerts (AT-1)", () => {
  it("says which level the uploader's file crossed, with the pool's numbers", () => {
    expect(
      spineActivityLine(
        entry("attachments.storage_80", {
          level: 80,
          used_bytes: 1.65 * 1073741824,
          total_bytes: 2 * 1073741824,
        }),
      ),
    ).toBe("filled storage past 80% (1.7 of 2 GB)");
    expect(
      spineActivityLine(
        entry("attachments.storage_95", {
          level: 95,
          used_bytes: 47.6 * 1073741824,
          total_bytes: 50 * 1073741824,
        }),
      ),
    ).toBe("filled storage past 95% (48 of 50 GB)");
  });

  it("still reads without the numbers", () => {
    expect(spineActivityLine(entry("attachments.storage_95"))).toBe("filled storage past 95%");
  });
});

describe("bookings in the host's bell (TX-5)", () => {
  const START = "2026-10-16T12:00:00Z";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const day = dayShort(new Date(START), zone);
  const time = time24(new Date(START), zone);
  const booked = {
    op: "calendar.booking_create",
    actorType: "user" as const,
    actorId: "host",
    actorLabel: "Anna Carter",
    payload: {
      title: "Intro call",
      guest: "tom@becker.studio",
      guest_name: "Tom Becker",
      start: START,
    },
  };

  it("names the guest, not the host recorded as the actor", () => {
    expect(spineActorName(booked, "host")).toBe("Tom Becker");
    expect(spineActorName({ ...booked, payload: { guest: "tom@becker.studio" } }, "host")).toBe(
      "tom@becker.studio",
    );
    // An older row with no guest falls back to the usual actor.
    expect(spineActorName({ ...booked, payload: {} }, "host")).toBe("You");
  });

  it("reads like the ratified line", () => {
    expect(spineActivityLine(booked)).toBe(`booked Intro call · ${day}, ${time}`);
    expect(spineActivityLine({ ...booked, op: "calendar.booking_cancel" })).toBe(
      `canceled Intro call · ${day}`,
    );
    expect(spineActivityLine(entry("calendar.booking_cancel"))).toBe("canceled a meeting");
  });
});
