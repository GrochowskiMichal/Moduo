// Spine gestures on the rebuilt mail engine (MR-14, AC33): `t` convert, `l`
// link, `n` private note, drag onto a task or a calendar day, and "Create event
// from this email". Convert stays client-orchestrated (the EM-8 decision), so
// every gesture is a sequence of shipped ops through one injected port. Each
// step records what it created; a mid-sequence failure and the gesture's Undo
// share one teardown that removes only those artifacts (never a ref, link or
// contact link that existed before).

import type { RelationKind } from "@contracts/vocabularies";

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { buildConvertDescription, cleanTaskTitle } from "../convert";

export type SpineEntity = { type: string; id: string; label?: string | null };

export type SpineLinkInput = {
  source: SpineEntity;
  target: SpineEntity;
  /** Closed vocabulary: `links_op_create` refuses anything outside it. */
  relationKind: RelationKind;
};

/** The ops a gesture runs. The app adapter maps these onto `getRuntime()`. */
export type MailSpinePort = {
  /** Pull the thread into the tissue; `created` when this call made the ref. */
  upsertRef(thread: MailThreadRow): Promise<{ id: string; created: boolean }>;
  removeRef(refId: string): Promise<void>;
  createTask(input: {
    title: string;
    description: string;
    dueDate?: string | null;
  }): Promise<{ id: string }>;
  deleteTask(taskId: string): Promise<void>;
  /** A private note (only the author sees it). */
  createNote(input: { title: string; body: string }): Promise<{ id: string }>;
  deleteNote(noteId: string): Promise<void>;
  createEvent(input: {
    title: string;
    description: string;
    startMs: number;
    endMs: number;
  }): Promise<{ id: string }>;
  deleteEvent(eventId: string): Promise<void>;
  /** True when the two entities are already linked, either direction. */
  isLinked(a: SpineEntity, b: SpineEntity): Promise<boolean>;
  createLink(input: SpineLinkInput): Promise<{ id: string } | null>;
  deleteLink(linkId: string): Promise<void>;
  /** The sender's contact, when one matches any of its addresses (never creates). */
  resolveContactId(address: string | null): string | null;
  /** "Also mark done": a Done op; returns its undo. */
  markDone?(threadId: string): Promise<(() => Promise<void>) | null>;
};

/** What a gesture made, so Undo removes exactly that. */
export type SpinePlan = {
  refId: string | null;
  refCreated: boolean;
  taskId: string | null;
  noteId: string | null;
  eventId: string | null;
  linkIds: string[];
  undoDone: (() => Promise<void>) | null;
};

export type SpineResult = { plan: SpinePlan; undo: () => Promise<void> };

export type MailDropTarget =
  { kind: "task"; taskId: string; label?: string } | { kind: "day"; date: string };

function emptyPlan(): SpinePlan {
  return {
    refId: null,
    refCreated: false,
    taskId: null,
    noteId: null,
    eventId: null,
    linkIds: [],
    undoDone: null,
  };
}

const lastSender = (t: MailThreadRow) => t.senders[t.senders.length - 1] ?? null;
const subjectOf = (t: MailThreadRow) => t.subject || "(no subject)";

export function createMailSpineCommands(port: MailSpinePort) {
  async function teardown(plan: SpinePlan) {
    // Reverse order, each step best-effort so one failure never strands the rest.
    const safe = (p: Promise<unknown> | undefined) => p?.catch(() => {});
    if (plan.undoDone) await safe(plan.undoDone());
    for (const id of [...plan.linkIds].reverse()) await safe(port.deleteLink(id));
    if (plan.eventId) await safe(port.deleteEvent(plan.eventId));
    if (plan.noteId) await safe(port.deleteNote(plan.noteId));
    if (plan.taskId) await safe(port.deleteTask(plan.taskId));
    if (plan.refId && plan.refCreated) await safe(port.removeRef(plan.refId));
  }

  async function run(build: (plan: SpinePlan) => Promise<void>): Promise<SpineResult> {
    const plan = emptyPlan();
    try {
      await build(plan);
    } catch (err) {
      await teardown(plan);
      throw err;
    }
    let undone = false;
    return {
      plan,
      undo: async () => {
        if (undone) return;
        undone = true;
        await teardown(plan);
      },
    };
  }

  async function ref(plan: SpinePlan, thread: MailThreadRow): Promise<SpineEntity> {
    const r = await port.upsertRef(thread);
    plan.refId = r.id;
    plan.refCreated = r.created;
    return { type: "email_thread", id: r.id, label: subjectOf(thread) };
  }

  /** Link unless already linked; only a link this call made goes on the plan. */
  async function linkOnce(plan: SpinePlan, input: SpineLinkInput) {
    if (await port.isLinked(input.source, input.target)) return;
    const link = await port.createLink(input);
    if (link) plan.linkIds.push(link.id);
  }

  async function linkContact(plan: SpinePlan, threadRef: SpineEntity, thread: MailThreadRow) {
    const contactId = port.resolveContactId(lastSender(thread)?.email ?? null);
    if (!contactId) return;
    await linkOnce(plan, {
      source: threadRef,
      target: { type: "contact", id: contactId, label: lastSender(thread)?.name ?? null },
      relationKind: "references",
    });
  }

  async function convertInto(
    plan: SpinePlan,
    thread: MailThreadRow,
    opts: { dueDate?: string | null; alsoDone?: boolean },
  ) {
    const threadRef = await ref(plan, thread);
    const title = cleanTaskTitle(thread.subject);
    const task = await port.createTask({
      title,
      description: buildConvertDescription({
        snippet: thread.snippet,
        subject: thread.subject,
        refId: threadRef.id,
      }),
      dueDate: opts.dueDate ?? null,
    });
    plan.taskId = task.id;
    await linkOnce(plan, {
      source: { type: "task", id: task.id, label: title },
      target: threadRef,
      relationKind: "spawned-from",
    });
    await linkContact(plan, threadRef, thread);
    if (opts.alsoDone && port.markDone) plan.undoDone = await port.markDone(thread.threadId);
  }

  return {
    /** `t`: a task spawned from the thread; the thread references the contact. */
    convert(thread: MailThreadRow, opts: { alsoDone?: boolean } = {}) {
      return run((plan) => convertInto(plan, thread, opts));
    },
    /**
     * "Also mark done" from the convert toast: Done on the thread, chained onto
     * the convert's plan so its one Undo reverts the Done and the task together.
     * False when Done isn't wired or already ran for this convert.
     */
    async alsoDone(result: SpineResult, thread: MailThreadRow): Promise<boolean> {
      if (!port.markDone || result.plan.undoDone) return false;
      result.plan.undoDone = await port.markDone(thread.threadId);
      return true;
    },
    /** `l`: link the thread to a task, contact, note or project. */
    link(thread: MailThreadRow, target: SpineEntity) {
      return run(async (plan) => {
        const threadRef = await ref(plan, thread);
        await linkOnce(plan, { source: threadRef, target, relationKind: "references" });
      });
    },
    /** `n`: a private note linked to the thread. */
    note(thread: MailThreadRow) {
      return run(async (plan) => {
        const threadRef = await ref(plan, thread);
        const from = lastSender(thread);
        const note = await port.createNote({
          title: cleanTaskTitle(thread.subject),
          body: from ? `From ${from.name || from.email}` : "",
        });
        plan.noteId = note.id;
        await linkOnce(plan, {
          source: { type: "note", id: note.id },
          target: threadRef,
          relationKind: "references",
        });
      });
    },
    /** Drag a thread onto a task (link) or a calendar day (a task due that day). */
    drop(thread: MailThreadRow, target: MailDropTarget) {
      if (target.kind === "day")
        return run((plan) => convertInto(plan, thread, { dueDate: target.date }));
      return run(async (plan) => {
        const threadRef = await ref(plan, thread);
        await linkOnce(plan, {
          source: { type: "task", id: target.taskId, label: target.label ?? null },
          target: threadRef,
          relationKind: "references",
        });
      });
    },
    /** "Create event from this email": the event references the thread. */
    /** A linked event; an invite passes its own title and location (AC18). */
    createEvent(
      thread: MailThreadRow,
      at: { startMs: number; endMs: number },
      from?: { title: string; location: string | null },
    ) {
      return run(async (plan) => {
        const threadRef = await ref(plan, thread);
        const title = from?.title.trim() || cleanTaskTitle(thread.subject);
        const where = from?.location ? `Location: ${from.location}\n\n` : "";
        const event = await port.createEvent({
          title,
          description:
            where +
            buildConvertDescription({
              snippet: thread.snippet,
              subject: thread.subject,
              refId: threadRef.id,
            }),
          startMs: at.startMs,
          endMs: Math.max(at.endMs, at.startMs),
        });
        plan.eventId = event.id;
        await linkOnce(plan, {
          source: { type: "calendar_event", id: event.id, label: title },
          target: threadRef,
          relationKind: "references",
        });
        await linkContact(plan, threadRef, thread);
      });
    },
  };
}

export type MailSpineCommands = ReturnType<typeof createMailSpineCommands>;
