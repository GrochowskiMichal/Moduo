// Invite card, Subscriptions unsubscribe and Gmail labels on the real engine
// path: the Tauri `MailEngine` over scripted `mail_*` commands (the Rust side
// is covered by `mail/invite.rs`, `mail/unsubscribe.rs` and
// `commands/mail_engine.rs` tests), the app runtime's Calendar create and the
// spine links, never the fixture engine.

import { describe, expect, it } from "@rstest/core";

import { createTauriMailEngine } from "@/lib/runtime.tauri.mail-engine";
import type {
  MailInviteInfo,
  MailMessage,
  MailThread,
  MailThreadRow,
} from "@/lib/runtime.types.mail-engine";

import { createMailSpineCommands } from "../commands/spine";
import { createMailCommands } from "../commands/triage";
import { createMailStore } from "../store/mail-store";
import { labelChoices, labelOp, supportsLabels } from "../ui/mail-labels";
import { createRuntimeSpinePort, type SpineRuntime } from "../ui/mail-page-wiring";
import {
  addInviteToCalendar,
  engineInviteLoader,
  engineRsvp,
  unsubscribeSender,
} from "./engine-reader";

const row: MailThreadRow = {
  threadId: "t1",
  accountId: "a1",
  subject: "Invitation: Board prep",
  snippet: "",
  senders: [{ name: "Anna", email: "anna@x.com" }],
  lastDateMs: 0,
  messageCount: 1,
  unread: true,
  pinned: false,
  hasAttachments: false,
  hasInvite: true,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
};

const msg = (over: Partial<MailMessage>): MailMessage =>
  ({
    id: "m1",
    listUnsubscribe: null,
    hasInvite: false,
    attachments: [],
    ...over,
  }) as MailMessage;

const invite: MailInviteInfo = {
  uid: "evt-1@x.com",
  method: "REQUEST",
  summary: "Board prep",
  startMs: Date.UTC(2026, 10, 5, 14),
  endMs: Date.UTC(2026, 10, 5, 15),
  location: "Room 4",
  organizer: { name: "Anna", email: "anna@x.com" },
  myStatus: null,
  canRsvp: true,
};

function scripted(answers: Record<string, unknown>) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const engine = createTauriMailEngine(
    async <T>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      const a = answers[cmd];
      return (typeof a === "function" ? a(args) : (a ?? null)) as T;
    },
    () => "channel",
  );
  return { engine, calls };
}

describe("invite card on the engine (AC18)", () => {
  it("loads the engine's parsed invite, RSVPs through mail_rsvp and adds a linked Moduo event", async () => {
    const { engine, calls } = scripted({ mail_get_invite: invite });
    const card = await engineInviteLoader(engine, "t1")!("m1");
    expect(card?.summary).toBe("Board prep");
    expect(card?.organizer?.email).toBe("anna@x.com");
    await engineRsvp(engine, "t1")!("m1", "TENTATIVE");
    expect(calls).toContainEqual([
      "mail_rsvp",
      { threadId: "t1", messageId: "m1", answer: "maybe" },
    ]);

    const log: string[] = [];
    const rt = {
      email: { upsertRef: async () => ({ id: "ref1" }), removeRef: async () => {} },
      tasks: { upsertTask: async () => ({ id: "x" }), deleteTask: async () => {} },
      notes: { create: async () => ({ id: "x" }), trash: async () => {} },
      calendar: {
        createEvent: async (i: { title: string; startsAt: string; description?: string }) => (
          log.push(`event ${i.title} ${i.startsAt} ${i.description?.split("\n")[0]}`),
          { id: "ev1" }
        ),
        removeEvent: async () => void log.push("-event"),
      },
      spine: {
        listLinks: async () => [],
        createLink: async (i: { source: { type: string }; target: { type: string } }) => (
          log.push(`link ${i.source.type}->${i.target.type}`),
          { id: "l1" }
        ),
        deleteLink: async () => void log.push("-link"),
      },
    } as unknown as SpineRuntime;
    const spine = createMailSpineCommands(
      createRuntimeSpinePort({
        runtime: rt,
        workspaceId: "w",
        makeTask: (i) => i,
        hasRef: () => false,
        contacts: [],
      }),
    );
    const res = await addInviteToCalendar(spine, row, card!);
    expect(log).toEqual([
      `event Board prep ${new Date(invite.startMs).toISOString()} Location: Room 4`,
      "link calendar_event->email_thread",
    ]);
    await res.undo();
    expect(log.slice(2)).toEqual(["-link", "-event"]);
  });

  it("an invite without an organizer offers no RSVP", async () => {
    const { engine } = scripted({ mail_get_invite: { ...invite, canRsvp: false } });
    expect((await engineInviteLoader(engine, "t1")!("m1"))?.organizer).toBeNull();
  });
});

describe("Subscriptions unsubscribe on the engine (AC29)", () => {
  const thread = (id: string, header: string | null): MailThread => ({
    row: { ...row, threadId: id },
    messages: [msg({ id: `${id}-m`, listUnsubscribe: header })],
  });

  it("runs the reader's vetted plan on the sender's thread that offers one", async () => {
    const { engine, calls } = scripted({
      mail_get_thread: (a: { threadId: string }) =>
        a.threadId === "t1" ? thread("t1", null) : thread("t2", "<https://x.test/u>"),
      mail_unsubscribe_plan: [{ kind: "oneClick", url: "https://x.test/u" }],
      mail_unsubscribe: {
        method: "one_click",
        done: true,
        url: null,
        fellBack: false,
        error: null,
      },
    });
    const notice = await unsubscribeSender(engine, ["t1", "t2"], {
      confirmMailto: async () => false,
      openUrl: () => {},
    });
    expect(notice).toBe("Unsubscribed.");
    expect(calls).toContainEqual([
      "mail_unsubscribe",
      { threadId: "t2", messageId: "t2-m", allowMailto: false },
    ]);
  });

  it("asks before a mailto and names its recipient", async () => {
    const asked: string[] = [];
    const { engine, calls } = scripted({
      mail_get_thread: thread("t1", "<mailto:u@x.test>"),
      mail_unsubscribe_plan: [{ kind: "mailto", to: "u@x.test", subject: null, body: null }],
      mail_unsubscribe: { method: "mailto", done: true, url: null, fellBack: false, error: null },
    });
    await unsubscribeSender(engine, ["t1"], {
      confirmMailto: async (to) => (asked.push(to), true),
      openUrl: () => {},
    });
    expect(asked).toEqual(["u@x.test"]);
    expect(calls.at(-1)).toEqual([
      "mail_unsubscribe",
      { threadId: "t1", messageId: "t1-m", allowMailto: true },
    ]);
  });

  it("a sender without List-Unsubscribe says so", async () => {
    const { engine } = scripted({ mail_get_thread: thread("t1", null) });
    await expect(
      unsubscribeSender(engine, ["t1"], { confirmMailto: async () => false, openUrl: () => {} }),
    ).rejects.toThrow(/doesn't offer/);
  });
});

describe("Gmail labels on the engine (AC9)", () => {
  it("sends label_add / label_remove with args.mailboxId through mail_apply_op", async () => {
    const { engine, calls } = scripted({ mail_apply_op: { opIds: ["o1"] } });
    const commands = createMailCommands(createMailStore({ engine }));
    await commands.apply(labelOp("label_add", ["t1", "t2"], "g-work"));
    await commands.apply(labelOp("label_remove", ["t1"], "g-work"));
    expect(calls.filter(([c]) => c === "mail_apply_op").map(([, a]) => a)).toEqual([
      { input: { kind: "label_add", threadIds: ["t1", "t2"], args: { mailboxId: "g-work" } } },
      { input: { kind: "label_remove", threadIds: ["t1"], args: { mailboxId: "g-work" } } },
    ]);
  });

  it("offers only a Gmail account's custom folders as labels", () => {
    expect(supportsLabels({ provider: "gmail" })).toBe(true);
    expect(supportsLabels({ provider: "google_workspace" })).toBe(true);
    expect(supportsLabels({ provider: "icloud" })).toBe(false);
    const box = (id: string, name: string, role: "custom" | "inbox") =>
      ({ id, accountId: "a1", name, path: name, role, unread: 0, total: 0 }) as const;
    expect(
      labelChoices([
        box("i", "Inbox", "inbox"),
        box("w", "Work", "custom"),
        box("b", "Bills", "custom"),
      ]).map((b) => b.name),
    ).toEqual(["Bills", "Work"]);
  });
});
