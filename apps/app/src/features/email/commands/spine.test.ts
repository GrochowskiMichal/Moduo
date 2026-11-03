import { describe, expect, it } from "@rstest/core";

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { createMailSpineCommands, type MailSpinePort, type SpineEntity } from "./spine";

const thread: MailThreadRow = {
  threadId: "t1",
  accountId: "gmail:me@x.com",
  subject: "Re: Contract draft",
  snippet: "Please review",
  senders: [{ name: "Anna", email: "anna@acme.com" }],
  lastDateMs: 1,
  messageCount: 2,
  unread: true,
  pinned: false,
  hasAttachments: false,
  hasInvite: false,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
};

type Link = { id: string; a: SpineEntity; b: SpineEntity; kind: string };

function fakePort(opts: { refExists?: boolean; contact?: boolean; preLinked?: boolean; failNote?: boolean } = {}) {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const state = {
    refs: new Set<string>(opts.refExists ? ["ref-t1"] : []),
    tasks: new Map<string, { title: string; dueDate: string | null }>(),
    notes: new Set<string>(),
    events: new Set<string>(),
    links: [] as Link[],
    done: [] as string[],
  };
  if (opts.preLinked) {
    state.links.push({
      id: "pre",
      a: { type: "email_thread", id: "ref-t1" },
      b: { type: "contact", id: "c1" },
      kind: "references",
    });
  }
  const same = (x: SpineEntity, y: SpineEntity) => x.type === y.type && x.id === y.id;
  const port: MailSpinePort = {
    async upsertRef() {
      const created = !state.refs.has("ref-t1");
      state.refs.add("ref-t1");
      return { id: "ref-t1", created };
    },
    async removeRef(refId) {
      state.refs.delete(refId);
    },
    async createTask(input) {
      const tid = id("task");
      state.tasks.set(tid, { title: input.title, dueDate: input.dueDate ?? null });
      return { id: tid };
    },
    async deleteTask(tid) {
      state.tasks.delete(tid);
    },
    async createNote() {
      if (opts.failNote) throw new Error("notes down");
      const nid = id("note");
      state.notes.add(nid);
      return { id: nid };
    },
    async deleteNote(nid) {
      state.notes.delete(nid);
    },
    async createEvent() {
      const eid = id("ev");
      state.events.add(eid);
      return { id: eid };
    },
    async deleteEvent(eid) {
      state.events.delete(eid);
    },
    async isLinked(a, b) {
      return state.links.some((l) => (same(l.a, a) && same(l.b, b)) || (same(l.a, b) && same(l.b, a)));
    },
    async createLink(input) {
      const lid = id("link");
      state.links.push({ id: lid, a: input.source, b: input.target, kind: input.relationKind });
      return { id: lid };
    },
    async deleteLink(lid) {
      state.links = state.links.filter((l) => l.id !== lid);
    },
    resolveContactId: (addr) => (opts.contact && addr === "anna@acme.com" ? "c1" : null),
    async markDone(threadId) {
      state.done.push(threadId);
      return async () => {
        state.done = state.done.filter((x) => x !== threadId);
      };
    },
  };
  return { port, state };
}

describe("mail spine commands (AC33)", () => {
  it("convert: task spawned-from the thread, thread references the contact, Undo removes all", async () => {
    const { port, state } = fakePort({ contact: true });
    const cmds = createMailSpineCommands(port);
    const res = await cmds.convert(thread, { alsoDone: true });
    const [task] = [...state.tasks.values()];
    expect(task?.title).toBe("Contract draft");
    expect(state.links.map((l) => `${l.a.type}>${l.b.type}:${l.kind}`)).toEqual([
      "task>email_thread:spawned-from",
      "email_thread>contact:references",
    ]);
    expect(state.done).toEqual(["t1"]);
    await res.undo();
    expect(state.tasks.size).toBe(0);
    expect(state.links).toEqual([]);
    expect(state.refs.size).toBe(0);
    expect(state.done).toEqual([]);
  });

  it("convert undo keeps a ref and a contact link that existed before", async () => {
    const { port, state } = fakePort({ contact: true, refExists: true, preLinked: true });
    const res = await createMailSpineCommands(port).convert(thread);
    expect(state.links).toHaveLength(2);
    await res.undo();
    expect(state.refs.has("ref-t1")).toBe(true);
    expect(state.links.map((l) => l.id)).toEqual(["pre"]);
  });

  it("link: relates the thread to the target; undo removes only that link", async () => {
    const { port, state } = fakePort();
    const res = await createMailSpineCommands(port).link(thread, { type: "project", id: "p1" });
    expect(state.links).toHaveLength(1);
    expect(state.links[0]?.b).toEqual({ type: "project", id: "p1" });
    await res.undo();
    expect(state.links).toEqual([]);
  });

  it("note: a private note linked to the thread; a failure compensates", async () => {
    const { port, state } = fakePort();
    const res = await createMailSpineCommands(port).note(thread);
    expect(state.notes.size).toBe(1);
    expect(state.links[0]?.a.type).toBe("note");
    await res.undo();
    expect(state.notes.size).toBe(0);
    expect(state.links).toEqual([]);

    const broken = fakePort({ failNote: true });
    await expect(createMailSpineCommands(broken.port).note(thread)).rejects.toThrow("notes down");
    expect(broken.state.refs.size).toBe(0);
  });

  it("drag: onto a task links it, onto a day makes a task due that day", async () => {
    const { port, state } = fakePort();
    const cmds = createMailSpineCommands(port);
    await cmds.drop(thread, { kind: "task", taskId: "task-x" });
    expect(state.links[0]?.a).toEqual({ type: "task", id: "task-x", label: null });
    const day = await cmds.drop(thread, { kind: "day", date: "2026-11-10" });
    expect([...state.tasks.values()][0]?.dueDate).toBe("2026-11-10");
    await day.undo();
    expect(state.tasks.size).toBe(0);
    expect(state.links).toHaveLength(1);
  });

  it("event: the event references the thread; undo deletes the event and its link", async () => {
    const { port, state } = fakePort();
    const res = await createMailSpineCommands(port).createEvent(thread, { startMs: 10, endMs: 20 });
    expect(state.events.size).toBe(1);
    expect(state.links[0]?.a.type).toBe("calendar_event");
    await res.undo();
    expect(state.events.size).toBe(0);
    expect(state.links).toEqual([]);
  });
});
