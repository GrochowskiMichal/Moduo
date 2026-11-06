import { describe, expect, it } from "@rstest/core";

import type { EmailSettingsItem } from "@/lib/runtime.types.email";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { createMailSpineCommands } from "../commands/spine";
import {
  aliasesFromItems,
  createRuntimeSpinePort,
  customTabsFromItems,
  localDate,
  nextEventSlot,
  snippetsFromItems,
  type SpineRuntime,
  unsubscribeTarget,
} from "./mail-page-wiring";

const item = (kind: string, value: Record<string, unknown>, id = kind) =>
  ({
    id,
    kind,
    value,
    position: 0,
    updatedAt: "",
    deletedAt: null,
  }) as unknown as EmailSettingsItem;

const row: MailThreadRow = {
  threadId: "t1",
  accountId: "a1",
  subject: "Quote for Q3",
  snippet: "hi",
  senders: [{ name: "Ann", email: "Ann@x.com" }],
  lastDateMs: 0,
  messageCount: 1,
  unread: true,
  pinned: false,
  hasAttachments: false,
  hasInvite: false,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
};

function fakeRuntime() {
  const log: string[] = [];
  let n = 0;
  const rt: SpineRuntime = {
    email: {
      upsertRef: async () => (log.push("ref"), { id: "ref1" }),
      removeRef: async () => void log.push("-ref"),
    },
    tasks: {
      upsertTask: async () => (log.push("task"), { id: "task1" }),
      deleteTask: async () => void log.push("-task"),
    },
    notes: {
      create: async () => (log.push("note"), { id: "note1" }),
      trash: async () => void log.push("-note"),
    },
    calendar: {
      createEvent: async (i) => (log.push(`event ${i.startsAt}`), { id: "ev1" }),
      removeEvent: async () => void log.push("-event"),
    },
    spine: {
      listLinks: async () => [],
      createLink: async (i) => (
        log.push(`link ${i.source.type}->${i.target.type}`),
        { id: `l${++n}` }
      ),
      deleteLink: async () => void log.push("-link"),
    },
  };
  return { rt, log };
}

describe("mail page wiring", () => {
  it("reads aliases and snippets from the settings items", () => {
    const items = [
      item("alias", { address: "me@x.com", accountId: "a1", name: "Me", isDefault: true }),
      item("snippet", { name: "thanks", body: "Thanks {first}" }),
      item("rule", { name: "x" }),
    ];
    expect(aliasesFromItems(items)).toEqual([
      {
        id: "alias",
        accountId: "a1",
        address: "me@x.com",
        name: "Me",
        isDefault: true,
        signatureHtml: "",
      },
    ]);
    expect(snippetsFromItems(items)).toEqual([
      { id: "snippet", name: "thanks", body: "Thanks {first}" },
    ]);
  });

  it("picks the next half hour and the https unsubscribe first", () => {
    const at = new Date(2026, 10, 4, 9, 10).getTime();
    expect(nextEventSlot(at).startMs).toBe(new Date(2026, 10, 4, 9, 30).getTime());
    expect(localDate(at)).toBe("2026-11-04");
    expect(unsubscribeTarget("<mailto:u@x.com?subject=u>, <https://x.com/u>")).toEqual({
      kind: "web",
      url: "https://x.com/u",
    });
    expect(unsubscribeTarget("<mailto:u@x.com?subject=u>")).toEqual({
      kind: "mailto",
      address: "u@x.com",
    });
  });

  it("convert runs through the runtime and Undo removes what it made", async () => {
    const { rt, log } = fakeRuntime();
    const spine = createMailSpineCommands(
      createRuntimeSpinePort({
        runtime: rt,
        workspaceId: "w",
        makeTask: (i) => i,
        hasRef: () => false,
        contacts: [{ id: "c1", emails: ["ann@x.com"] }],
      }),
    );
    const res = await spine.convert(row);
    expect(log).toEqual(["ref", "task", "link task->email_thread", "link email_thread->contact"]);
    await res.undo();
    expect(log.slice(4)).toEqual(["-link", "-link", "-task", "-ref"]);
  });

  it("a thread already in the tissue keeps its ref on Undo", async () => {
    const { rt, log } = fakeRuntime();
    const spine = createMailSpineCommands(
      createRuntimeSpinePort({
        runtime: rt,
        workspaceId: "w",
        makeTask: (i) => i,
        hasRef: () => true,
        contacts: [],
      }),
    );
    const res = await spine.note(row);
    await res.undo();
    expect(log).toEqual(["ref", "note", "link note->email_thread", "-link", "-note"]);
  });
});

describe("customTabsFromItems (specs/mail-v3.md AC2)", () => {
  it("takes custom_tab items in position order, at most three, named", () => {
    const tab = (id: string, name: string, position: number) => ({
      ...item("custom_tab", { name, senders: [], domains: [] }, id),
      position,
    });
    const items = [
      tab("t4", "Later", 4),
      tab("t2", "Hiring", 2),
      item("snippet", { name: "thx", body: "Thanks" }),
      tab("t1", "Investors", 1),
      tab("t3", "Press", 3),
      tab("t0", "  ", 0),
    ];
    expect(customTabsFromItems(items)).toEqual([
      { id: "t1", label: "Investors" },
      { id: "t2", label: "Hiring" },
      { id: "t3", label: "Press" },
    ]);
  });
});
