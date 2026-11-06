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
  priorityPeopleFromItems,
  rulesFromItems,
  snippetsFromItems,
  type SpineRuntime,
  unsubscribeTarget,
  whoFromLinks,
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
      { id: "t1", label: "Investors", domains: [] },
      { id: "t2", label: "Hiring", domains: [] },
      { id: "t3", label: "Press", domains: [] },
    ]);
  });

  it("keeps a tab's domains, for Why here (MV-9)", () => {
    const items = [item("custom_tab", { name: "Investors", domains: ["northzone.vc"] }, "t1")];
    expect(customTabsFromItems(items)[0]?.domains).toEqual(["northzone.vc"]);
  });
});

describe("rulesFromItems and priorityPeopleFromItems (MV-9)", () => {
  it("names a rule by its name, else by what it does; priority people by address", () => {
    const items = [
      item("rule", { name: "Receipts", conditions: [], actions: [] }, "r1"),
      item(
        "rule",
        {
          conditions: [{ field: "from", value: "billing@shop.test" }],
          actions: [{ action: "skip_inbox" }],
        },
        "r2",
      ),
      item("priority_person", { address: "Boss@X.test" }, "p1"),
    ];
    const rules = rulesFromItems(items);
    expect(rules[0]).toEqual({ id: "r1", label: "Receipts" });
    expect(rules[1]?.id).toBe("r2");
    expect(rules[1]?.label).toContain("billing@shop.test");
    expect(priorityPeopleFromItems(items)).toEqual([{ id: "p1", address: "boss@x.test" }]);
  });
});

describe("linkedKindsFor (specs/mail-v3.md decision 7, AC15)", () => {
  const link = (sourceType: string, sourceId: string, targetType: string, targetId: string) => ({
    sourceType,
    sourceId,
    targetType,
    targetId,
  });

  it("reads each ref'd thread's links once and names the other ends' kinds", async () => {
    const { rt } = fakeRuntime();
    const asked: string[] = [];
    rt.spine.listLinks = async ({ entityId }) => {
      asked.push(entityId);
      if (entityId === "ref-a")
        return [
          link("task", "t1", "email_thread", "ref-a"),
          link("email_thread", "ref-a", "note", "n1"),
          link("email_thread", "ref-a", "project", "p1"),
        ];
      return [];
    };
    const port = createRuntimeSpinePort({
      runtime: rt,
      workspaceId: "w",
      makeTask: (i) => i,
      hasRef: () => true,
      contacts: [],
      refIdFor: (key) => ({ a: "ref-a", b: "ref-b" })[key] ?? null,
    });
    expect(await port.linkedKindsFor!(["a", "b", "no-ref"])).toEqual({ a: ["task", "note"] });
    // Threads without a cloud ref can't have links: no read for them.
    expect(asked).toEqual(["ref-a", "ref-b"]);
  });

  it("reads nothing without refIdFor (tests, the fixture engine)", async () => {
    const { rt } = fakeRuntime();
    let calls = 0;
    rt.spine.listLinks = async () => (calls++, []);
    const port = createRuntimeSpinePort({
      runtime: rt,
      workspaceId: "w",
      makeTask: (i) => i,
      hasRef: () => true,
      contacts: [],
    });
    expect(await port.linkedKindsFor!(["a"])).toEqual({});
    expect(calls).toBe(0);
  });
});

describe("the reader's spine reads (specs/mail-v3.md §8, MV-8)", () => {
  it("linksFor reads the thread ref's links with registry labels; unlink undoes", async () => {
    const { rt, log } = fakeRuntime();
    rt.spine.listLinks = async () => [
      {
        id: "l1",
        relationKind: "spawned-from",
        sourceType: "task",
        sourceId: "task1",
        targetType: "email_thread",
        targetId: "ref-known",
      },
      {
        id: "l2",
        relationKind: "references",
        sourceType: "email_thread",
        sourceId: "ref-known",
        targetType: "contact",
        targetId: "c1",
      },
      {
        id: "l3",
        relationKind: "references",
        sourceType: "note",
        sourceId: "gone",
        targetType: "email_thread",
        targetId: "ref-known",
      },
    ];
    rt.spine.getEntities = async () => [
      { type: "task", id: "task1", label: "Confirm Acme pilot" },
      { type: "contact", id: "c1", label: "Ann" },
      { type: "note", id: "gone", label: "Old", deletedAt: "2026-11-01T00:00:00Z" },
    ];
    const spine = createMailSpineCommands(
      createRuntimeSpinePort({
        runtime: rt,
        workspaceId: "w",
        makeTask: (i) => i,
        hasRef: (key) => key === "t-known",
        refIdFor: (key) => (key === "t-known" ? "ref-known" : null),
        contacts: [],
      }),
    );
    expect(await spine.linksFor("t-none")).toEqual([]);
    const links = await spine.linksFor("t-known");
    expect(links.map((l) => [l.entity.type, l.entity.label, l.relationKind])).toEqual([
      ["task", "Confirm Acme pilot", "spawned-from"],
      ["contact", "Ann", "references"],
    ]);
    const res = await spine.unlink(links[0]!);
    await res.undo();
    expect(log).toEqual(["-link", "link task->email_thread"]);
  });

  it("a ref made this session is found again after the port is rebuilt", async () => {
    const { rt } = fakeRuntime();
    let asked = "";
    rt.spine.listLinks = async (i) => ((asked = i.entityId), []);
    const deps = { runtime: rt, workspaceId: "w2", makeTask: (i: unknown) => i, contacts: [] };
    const first = createMailSpineCommands(createRuntimeSpinePort({ ...deps, hasRef: () => false }));
    await first.note(row);
    const again = createMailSpineCommands(createRuntimeSpinePort({ ...deps, hasRef: () => true }));
    await again.linksFor(row.threadId);
    expect(asked).toBe("ref1");
  });

  it("whoFromLinks counts open tasks, notes and the next meeting", () => {
    const now = new Date(2026, 10, 5, 10).getTime(); // Thu
    const who = whoFromLinks({
      contact: { id: "c1", name: "Jonas Weber", title: "Head of IT", company: "Acme" },
      links: [
        { sourceType: "task", sourceId: "t-open", targetType: "contact", targetId: "c1" },
        { sourceType: "contact", sourceId: "c1", targetType: "task", targetId: "t-open2" },
        { sourceType: "task", sourceId: "t-done", targetType: "contact", targetId: "c1" },
        { sourceType: "note", sourceId: "n1", targetType: "contact", targetId: "c1" },
        { sourceType: "calendar_event", sourceId: "e-past", targetType: "contact", targetId: "c1" },
        { sourceType: "calendar_event", sourceId: "e-next", targetType: "contact", targetId: "c1" },
      ],
      openTaskIds: new Set(["t-open", "t-open2"]),
      events: [
        { id: "e-past", startsAt: new Date(2026, 10, 2, 9).toISOString() },
        { id: "e-next", startsAt: new Date(2026, 10, 9, 9).toISOString() },
        { id: "e-other", startsAt: new Date(2026, 10, 6, 9).toISOString() },
      ],
      nowMs: now,
    });
    expect(who).toEqual({
      contactId: "c1",
      name: "Jonas Weber",
      role: "Head of IT",
      company: "Acme",
      lastTouch: null,
      openTasks: 2,
      notes: 1,
      nextMeeting: new Date(2026, 10, 9, 9).toLocaleDateString(undefined, { weekday: "short" }),
    });
  });
});
