// The page's glue (MR-14/MR-11 wiring): settings items → composer aliases and
// snippets, the runtime adapter behind `MailSpinePort`, and the small time and
// unsubscribe helpers the Today panel and Subscriptions view use. Pure apart
// from the injected runtime, so it is tested without a page.

import { MAIL_MAX_CUSTOM_TABS } from "@contracts/mail";

import type { EmailSettingsItem } from "@/lib/runtime.types.email";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import type { MailLinkedKind, MailSpinePort, SpineEntity } from "../commands/spine";
import type { MailAlias } from "../compose/aliases";
import type { MailSnippet } from "../compose/snippets";
import { resolveContactIdByAddress } from "../convert";
import { buildRefUpsertArgs } from "../refs";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Send-as aliases from the settings mirror (Settings → Mail → Aliases). */
export function aliasesFromItems(items: readonly EmailSettingsItem[]): MailAlias[] {
  return items
    .filter((i) => i.kind === "alias" && str(i.value.address))
    .map((i) => ({
      id: i.id,
      accountId: str(i.value.accountId),
      address: str(i.value.address),
      name: str(i.value.name),
      isDefault: i.value.isDefault === true,
      signatureHtml: str(i.value.signatureHtml),
    }));
}

/** `;;` snippets from the settings mirror. */
export function snippetsFromItems(items: readonly EmailSettingsItem[]): MailSnippet[] {
  return items
    .filter((i) => i.kind === "snippet" && str(i.value.name))
    .map((i) => ({ id: i.id, name: str(i.value.name), body: str(i.value.body) }));
}

/** Custom inbox tabs from the settings mirror: `custom_tab` items in their position
 *  order, at most three (specs/mail-v3.md §2, AC2). */
export function customTabsFromItems(
  items: readonly EmailSettingsItem[],
): { id: string; label: string }[] {
  return items
    .filter((i) => i.kind === "custom_tab" && str(i.value.name).trim())
    .sort((a, b) => a.position - b.position)
    .slice(0, MAIL_MAX_CUSTOM_TABS)
    .map((i) => ({ id: i.id, label: str(i.value.name).trim() }));
}

/** Local `YYYY-MM-DD` for a day drop. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "Create event from this email": the next half hour, 30 minutes long. */
export function nextEventSlot(nowMs: number): { startMs: number; endMs: number } {
  const half = 30 * 60_000;
  const startMs = Math.ceil((nowMs + 1) / half) * half;
  return { startMs, endMs: startMs + half };
}

/** The first usable List-Unsubscribe target: https first, then mailto. */
export function unsubscribeTarget(
  header: string | null,
): { kind: "web"; url: string } | { kind: "mailto"; address: string } | null {
  if (!header) return null;
  const parts = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim());
  const web = parts.find((p) => /^https:\/\//i.test(p));
  if (web) return { kind: "web", url: web };
  const mail = parts.find((p) => /^mailto:/i.test(p));
  if (mail) return { kind: "mailto", address: mail.slice(7).split("?")[0]! };
  return null;
}

/** The mail thread drag payload (a row dragged onto the Today panel). */
export const MAIL_THREAD_MIME = "application/x-moduo-mail-thread";

/** The runtime slices the spine adapter writes through. */
export type SpineRuntime = {
  email: {
    upsertRef(input: Record<string, unknown> & { workspaceId: string }): Promise<{ id: string }>;
    removeRef(input: { workspaceId: string; refId: string }): Promise<void>;
  };
  tasks: {
    upsertTask(task: never): Promise<{ id: string }>;
    deleteTask(input: { workspaceId: string; taskId: string }): Promise<unknown>;
  };
  notes: {
    create(input: { workspaceId: string; title?: string }): Promise<{ id: string }>;
    trash(input: { workspaceId: string; noteId: string }): Promise<unknown>;
  };
  calendar: {
    createEvent(input: {
      workspaceId: string;
      title: string;
      startsAt: string;
      endsAt: string;
      description?: string;
    }): Promise<{ id: string }>;
    removeEvent(input: { workspaceId: string; eventId: string }): Promise<void>;
  };
  spine: {
    listLinks(input: {
      workspaceId: string;
      entityType: string;
      entityId: string;
    }): Promise<{ sourceType: string; sourceId: string; targetType: string; targetId: string }[]>;
    createLink(input: {
      workspaceId: string;
      source: { type: string; id: string };
      target: { type: string; id: string };
      relationKind?: string;
      origin?: string;
      sourceLabel?: string;
      targetLabel?: string;
    }): Promise<{ id: string } | null>;
    deleteLink(input: { workspaceId: string; linkId: string }): Promise<unknown>;
  };
};

export type RuntimeSpineDeps = {
  runtime: SpineRuntime;
  workspaceId: string;
  /** Builds the task row (the Tasks inbox bucket, the end position). */
  makeTask(input: { title: string; description: string; dueDate: string | null }): unknown;
  /** Thread keys already in the tissue, so Undo never removes a prior ref. */
  hasRef(threadKey: string): boolean;
  contacts: readonly { id: string; emails: string[] }[];
  markDone?: MailSpinePort["markDone"];
  /** A thread's cloud ref id (its `email_thread` entity), when it has one. Absent
   *  (tests, the fixture engine), the row flags read no links. */
  refIdFor?: (threadKey: string) => string | null;
};

/** The spine entity types a thread's row flags name (decision 7). */
const LINKED_KIND: Readonly<Record<string, MailLinkedKind>> = {
  task: "task",
  note: "note",
  calendar_event: "event",
  contact: "contact",
};

/** Which kinds each thread links to: the `email_thread` end of its ref's links. Only
 *  threads with a ref can have links, so the read covers just those, in parallel. */
async function readLinkedKinds(
  rt: SpineRuntime,
  workspaceId: string,
  threadIds: readonly string[],
  refIdFor: (threadKey: string) => string | null,
): Promise<Record<string, MailLinkedKind[]>> {
  const pairs = threadIds
    .map((id) => [id, refIdFor(id)] as const)
    .filter((p): p is readonly [string, string] => Boolean(p[1]));
  const answers = await Promise.all(
    pairs.map(async ([threadId, refId]) => {
      const links = await rt.spine.listLinks({
        workspaceId,
        entityType: "email_thread",
        entityId: refId,
      });
      const kinds = new Set<MailLinkedKind>();
      for (const l of links) {
        const own = l.sourceType === "email_thread" && l.sourceId === refId;
        const kind = LINKED_KIND[own ? l.targetType : l.sourceType];
        if (kind) kinds.add(kind);
      }
      return [threadId, [...kinds]] as [string, MailLinkedKind[]];
    }),
  );
  return Object.fromEntries(answers.filter(([, kinds]) => kinds.length > 0));
}

const same = (a: SpineEntity, type: string, id: string) => a.type === type && a.id === id;

/** `MailSpinePort` over the app runtime (EM-8's client-orchestrated sequence). */
export function createRuntimeSpinePort(deps: RuntimeSpineDeps): MailSpinePort {
  const { runtime: rt, workspaceId } = deps;
  return {
    async upsertRef(thread: MailThreadRow) {
      const created = !deps.hasRef(thread.threadId);
      const from = thread.senders[thread.senders.length - 1] ?? null;
      const ref = await rt.email.upsertRef({
        workspaceId,
        ...buildRefUpsertArgs({
          threadKey: thread.threadId,
          accountId: thread.accountId,
          fromAddr: from?.email || null,
          fromName: from?.name || null,
          subject: thread.subject || null,
          snippet: thread.snippet || null,
          sentAt: new Date(thread.lastDateMs).toISOString(),
        }),
      });
      return { id: ref.id, created };
    },
    removeRef: (refId) => rt.email.removeRef({ workspaceId, refId }),
    async createTask(input) {
      const task = deps.makeTask({ ...input, dueDate: input.dueDate ?? null });
      return rt.tasks.upsertTask(task as never);
    },
    deleteTask: async (taskId) => void (await rt.tasks.deleteTask({ workspaceId, taskId })),
    createNote: (input) => rt.notes.create({ workspaceId, title: input.title }),
    deleteNote: async (noteId) => void (await rt.notes.trash({ workspaceId, noteId })),
    createEvent: (input) =>
      rt.calendar.createEvent({
        workspaceId,
        title: input.title,
        description: input.description,
        startsAt: new Date(input.startMs).toISOString(),
        endsAt: new Date(input.endMs).toISOString(),
      }),
    deleteEvent: (eventId) => rt.calendar.removeEvent({ workspaceId, eventId }),
    async isLinked(a, b) {
      try {
        const links = await rt.spine.listLinks({ workspaceId, entityType: a.type, entityId: a.id });
        return links.some(
          (l) =>
            (same(a, l.sourceType, l.sourceId) && same(b, l.targetType, l.targetId)) ||
            (same(b, l.sourceType, l.sourceId) && same(a, l.targetType, l.targetId)),
        );
      } catch {
        // Can't tell: treat as linked so Undo never deletes a link made earlier.
        return true;
      }
    },
    async createLink(input) {
      const link = await rt.spine.createLink({
        workspaceId,
        source: { type: input.source.type, id: input.source.id },
        target: { type: input.target.type, id: input.target.id },
        relationKind: input.relationKind,
        origin: "manual",
        ...(input.source.label ? { sourceLabel: input.source.label } : {}),
        ...(input.target.label ? { targetLabel: input.target.label } : {}),
      });
      return link ? { id: link.id } : null;
    },
    deleteLink: async (linkId) => void (await rt.spine.deleteLink({ workspaceId, linkId })),
    resolveContactId: (address) => resolveContactIdByAddress(address, [...deps.contacts]),
    markDone: deps.markDone,
    async linkedKindsFor(threadIds) {
      if (!deps.refIdFor || threadIds.length === 0) return {};
      return readLinkedKinds(rt, workspaceId, threadIds, deps.refIdFor);
    },
  };
}
