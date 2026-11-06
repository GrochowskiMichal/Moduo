// The page's glue (MR-14/MR-11 wiring): settings items → composer aliases and
// snippets, the runtime adapter behind `MailSpinePort`, and the small time and
// unsubscribe helpers the Today panel and Subscriptions view use. Pure apart
// from the injected runtime, so it is tested without a page.

import { MAIL_MAX_CUSTOM_TABS } from "@contracts/mail";

import type { EmailSettingsItem } from "@/lib/runtime.types.email";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { describeRule } from "../../settings/mail/model";
import type { MailLinkedKind, MailSpinePort, MailThreadLink, SpineEntity } from "../commands/spine";
import type { MailAlias } from "../compose/aliases";
import type { MailSnippet } from "../compose/snippets";
import { resolveContactIdByAddress } from "../convert";
import { shortDay } from "../reader/reader-format";
import type { MailWho } from "../reader/who-card";
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
): { id: string; label: string; domains: string[] }[] {
  return items
    .filter((i) => i.kind === "custom_tab" && str(i.value.name).trim())
    .sort((a, b) => a.position - b.position)
    .slice(0, MAIL_MAX_CUSTOM_TABS)
    .map((i) => ({
      id: i.id,
      label: str(i.value.name).trim(),
      // "Why is this in {Tab}?" names the domain a tab collects (MV-9).
      domains: (Array.isArray(i.value.domains) ? i.value.domains : []).map(str).filter(Boolean),
    }));
}

/** Rules from the settings mirror, named for "Why is this in {Tab}?": the rule's
 *  own name when it has one, else what it does ("From anna@x.com → skip the inbox"). */
export function rulesFromItems(
  items: readonly EmailSettingsItem[],
): { id: string; label: string }[] {
  return items
    .filter((i) => i.kind === "rule")
    .map((i) => ({ id: i.id, label: str(i.value.name).trim() || describeRule(i.value) }));
}

/** Priority people from the settings mirror (item id, lower-case address). */
export function priorityPeopleFromItems(
  items: readonly EmailSettingsItem[],
): { id: string; address: string }[] {
  return items
    .filter((i) => i.kind === "priority_person" && str(i.value.address).trim())
    .map((i) => ({ id: i.id, address: str(i.value.address).trim().toLowerCase() }));
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
    }): Promise<SpineLinkRow[]>;
    /** Registry labels for the other ends of a thread's links (the reader's chips). */
    getEntities?(input: {
      workspaceId: string;
      refs: { type: string; id: string }[];
    }): Promise<{ type: string; id: string; label: string; deletedAt?: string | null }[]>;
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
   *  (tests, the fixture engine), the row flags read no links and the reader's chips
   *  only the refs made this session. */
  refIdFor?: (threadKey: string) => string | null;
};

/** One `entity_links` row as the spine runtime returns it (the fields the port reads). */
export type SpineLinkRow = {
  id?: string;
  relationKind?: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
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

/** Ref ids this session made, kept across port rebuilds (the tissue list loads once). */
const sessionRefs = new Map<string, string>();
const refKey = (workspaceId: string, threadKey: string) => `${workspaceId}:${threadKey}`;

const LINK_KINDS = new Set<MailThreadLink["relationKind"]>([
  "spawned-from",
  "references",
  "related",
]);

/** The thread ref's links, each with its other end labelled from the registry. */
async function readThreadLinks(
  rt: SpineRuntime,
  workspaceId: string,
  refId: string,
): Promise<MailThreadLink[]> {
  const self = { type: "email_thread", id: refId };
  const rows = await rt.spine.listLinks({ workspaceId, entityType: self.type, entityId: refId });
  const links = rows.flatMap((l): MailThreadLink[] => {
    if (!l.id) return [];
    const source = { type: l.sourceType, id: l.sourceId };
    const target = { type: l.targetType, id: l.targetId };
    const kind = l.relationKind as MailThreadLink["relationKind"];
    return [
      {
        linkId: l.id,
        entity: same(self, source.type, source.id) ? target : source,
        source,
        target,
        relationKind: LINK_KINDS.has(kind) ? kind : "references",
      },
    ];
  });
  if (links.length === 0 || !rt.spine.getEntities) return links;
  const records = await rt.spine
    .getEntities({ workspaceId, refs: links.map((l) => ({ ...l.entity })) })
    .catch(() => []);
  const label = new Map(records.map((r) => [`${r.type}:${r.id}`, r]));
  return links
    .filter((l) => !label.get(`${l.entity.type}:${l.entity.id}`)?.deletedAt)
    .map((l) => ({
      ...l,
      entity: { ...l.entity, label: label.get(`${l.entity.type}:${l.entity.id}`)?.label ?? null },
    }));
}

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
      sessionRefs.set(refKey(workspaceId, thread.threadId), ref.id);
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
    async linksFor(threadId) {
      const refId =
        sessionRefs.get(refKey(workspaceId, threadId)) ?? deps.refIdFor?.(threadId) ?? null;
      return refId ? readThreadLinks(rt, workspaceId, refId) : [];
    },
  };
}

/** The who-card for a contact (MV-8): open tasks, notes and the next meeting linked to them. */
export function whoFromLinks(input: {
  contact: { id: string; name: string; title: string | null; company: string | null };
  links: readonly SpineLinkRow[];
  /** Tasks still open (not done, not archived). */
  openTaskIds: ReadonlySet<string>;
  events: readonly { id: string; startsAt: string }[];
  nowMs: number;
}): MailWho {
  const self = { type: "contact", id: input.contact.id };
  const others = input.links.map((l) =>
    same(self, l.sourceType, l.sourceId)
      ? { type: l.targetType, id: l.targetId }
      : { type: l.sourceType, id: l.sourceId },
  );
  const ids = (types: string[]) =>
    new Set(others.filter((o) => types.includes(o.type)).map((o) => o.id));
  const eventIds = ids(["calendar_event", "event"]);
  const next = input.events
    .filter((e) => eventIds.has(e.id))
    .map((e) => Date.parse(e.startsAt))
    .filter((ms) => Number.isFinite(ms) && ms > input.nowMs)
    .sort((a, b) => a - b)[0];
  return {
    contactId: input.contact.id,
    name: input.contact.name,
    role: input.contact.title,
    company: input.contact.company,
    lastTouch: null,
    openTasks: [...ids(["task"])].filter((id) => input.openTaskIds.has(id)).length,
    notes: ids(["note"]).size,
    nextMeeting: next === undefined ? null : shortDay(next, input.nowMs),
  };
}
