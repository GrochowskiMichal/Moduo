// The per-type preview resolvers (tasks-v3 §11, Assumptions #13; the facts
// are the table in research/capture-references-teams.md §6). Each module's
// item says what its chip and card show; the registry below maps a kind to
// its resolver. A resolver reads one batch of ids through
// `runtime.spine.previews` (row-level security = `can_access`) and answers per
// id: ready with facts, deleted, or private. An id that didn't come back is
// private: the answer carries no title and no type, by construction.
//
// The mappers are pure and exported for the tests; dates go through the one
// date grammar (lib/time-format.ts).

import { isOpenTaskStatus, normalizeTaskStatus } from "@contracts/vocabularies";

import type { EntityRecord, EntityRef } from "../../../lib/entity-links";
import { taskHandle } from "../../../lib/task-handle";
import { dayOffset, formatDate, formatDay, formatTime } from "../../../lib/time-format";
import type {
  ContactPreviewRow,
  EmailPreviewRow,
  EventPreviewRow,
  NotePreviewRow,
  ProjectPreviewRow,
  ReferencePreviewApi,
  TagPreviewRow,
  TaskPreviewRow,
} from "./rows";
import type {
  ReferenceFacts,
  ReferenceKind,
  ReferenceLevel,
  ReferenceMeta,
  ReferencePerson,
  ReferenceResolution,
  TaskCategory,
} from "./types";

/** What a resolver can use besides the ids. */
export type ResolveContext = {
  workspaceId: string;
  previews: ReferencePreviewApi;
  /** The workspace's task key, for handles (`MOD-142`). */
  taskKey: string | null;
  /** A workspace member by user id (an assignee), or null. */
  personOf: (userId: string) => ReferencePerson | null;
  /** The registry read, for kinds without their own resolver. */
  getEntities?: (refs: EntityRef[]) => Promise<EntityRecord[]>;
  /** Complete or reopen a task (a card's one action), when the reader can edit tasks. */
  setTaskStatus?: (taskId: string, done: boolean) => Promise<void>;
  now: () => Date;
};

export type Resolver = (
  ctx: ResolveContext,
  ids: string[],
  level: ReferenceLevel,
  /** The registry type the references were stored with (for `other`). */
  type: string,
) => Promise<Map<string, ReferenceResolution>>;

/** Answer every id: rows that came back by their state, the rest private. */
function answer<R extends { id: string; deletedAt: string | null }>(
  ids: readonly string[],
  rows: readonly R[],
  facts: (row: R) => ReferenceFacts,
): Map<string, ReferenceResolution> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, ReferenceResolution>();
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) out.set(id, { status: "private" });
    else if (row.deletedAt) out.set(id, { status: "deleted" });
    else out.set(id, { status: "ready", facts: facts(row) });
  }
  return out;
}

// ── task ─────────────────────────────────────────────────────────────────────

/** A status as its category; the icon belongs to the category (53a). */
export function taskCategory(status: string): TaskCategory {
  if (status === "backlog") return "backlog";
  const s = normalizeTaskStatus(status);
  if (s === "archived") return "wont_do";
  return s;
}

export function taskFacts(
  row: TaskPreviewRow,
  ctx: Pick<ResolveContext, "taskKey" | "personOf" | "now">,
  level: ReferenceLevel,
): ReferenceFacts {
  const now = ctx.now();
  const category = taskCategory(row.status);
  const open = isOpenTaskStatus(row.status) || category === "backlog";
  // A finished task's due date is noise; an open one's is its live fact.
  const due = open && row.dueDate ? formatDay(row.dueDate, now) : null;
  // Backlog is never late (REPLAN 53, TV-D9): its date shows, quietly.
  const late = category !== "backlog" && !!due && !!row.dueDate && dayOffset(row.dueDate, now) < 0;
  const handle = taskHandle(ctx.taskKey, row.number);
  const facts: ReferenceFacts = {
    kind: "task",
    title: row.title.trim() || "Untitled task",
    lead: { kind: "status", category },
    fact: due || null,
    factTone: late ? "late" : null,
    handle,
    bucketId: row.bucketId,
    card: null,
  };
  if (level === "chip") return facts;
  const meta: ReferenceMeta[] = [];
  if (handle) meta.push({ key: "handle", text: handle });
  // Never "Inbox" for someone else's: a project you can't see is private.
  const project =
    row.projectName === undefined
      ? null
      : row.projectName === null
        ? row.bucketId
          ? "Private project"
          : null
        : row.projectIsInbox
          ? "Inbox"
          : row.projectName.trim() || "Untitled project";
  if (project) meta.push({ key: "project", text: project, icon: "project" });
  if (due) meta.push({ key: "due", text: due, icon: "due", tone: late ? "late" : null });
  if (row.subtasks && row.subtasks.total > 0) {
    meta.push({
      key: "subtasks",
      text: `${row.subtasks.done}/${row.subtasks.total}`,
      icon: "subtasks",
      title: `${row.subtasks.done} of ${row.subtasks.total} subtasks done`,
    });
  }
  facts.card = {
    meta,
    person: row.assigneeId ? ctx.personOf(row.assigneeId) : null,
    action: { kind: "complete", done: category === "done" },
  };
  return facts;
}

const resolveTasks: Resolver = async (ctx, ids, level) => {
  const rows = await ctx.previews.tasks({
    workspaceId: ctx.workspaceId,
    ids,
    card: level === "card",
  });
  return answer(ids, rows, (row) => taskFacts(row, ctx, level));
};

// ── project ──────────────────────────────────────────────────────────────────

export function projectFacts(row: ProjectPreviewRow, level: ReferenceLevel): ReferenceFacts {
  const facts: ReferenceFacts = {
    kind: "project",
    title: row.isSystem ? "Inbox" : row.name.trim() || "Untitled project",
    lead: { kind: "dot", color: null },
    fact: null,
    card: null,
  };
  if (level === "chip") return facts;
  const meta: ReferenceMeta[] = [];
  if (row.progress && row.progress.total > 0) {
    meta.push({
      key: "progress",
      text: `${row.progress.done} of ${row.progress.total} done`,
      icon: "subtasks",
    });
  } else if (row.progress) {
    meta.push({ key: "progress", text: "No tasks yet" });
  }
  facts.card = { meta };
  return facts;
}

const resolveProjects: Resolver = async (ctx, ids, level) => {
  const rows = await ctx.previews.projects({
    workspaceId: ctx.workspaceId,
    ids,
    card: level === "card",
  });
  return answer(ids, rows, (row) => projectFacts(row, level));
};

// ── note ─────────────────────────────────────────────────────────────────────

export function noteFacts(
  row: NotePreviewRow,
  ctx: Pick<ResolveContext, "now">,
  level: ReferenceLevel,
): ReferenceFacts {
  const facts: ReferenceFacts = {
    kind: "note",
    title: row.title.trim() || "Untitled note",
    lead: { kind: "icon", type: "note" },
    fact: null,
    card: null,
  };
  if (level === "chip") return facts;
  const edited = row.updatedAt ? formatDate(row.updatedAt, ctx.now()) : "";
  facts.card = {
    excerpt: row.excerpt ?? null,
    meta: edited ? [{ key: "edited", text: `Edited ${edited}` }] : [],
  };
  return facts;
}

const resolveNotes: Resolver = async (ctx, ids, level) => {
  const rows = await ctx.previews.notes({
    workspaceId: ctx.workspaceId,
    ids,
    card: level === "card",
  });
  return answer(ids, rows, (row) => noteFacts(row, ctx, level));
};

// ── event ────────────────────────────────────────────────────────────────────

/** "Thu · 2:30 PM–3:00 PM", "Today · All day". */
export function eventWhen(row: EventPreviewRow, now: Date): string {
  const day = formatDay(row.startsAt, now);
  if (!day) return "";
  if (row.allDay) return `${day} · All day`;
  const end = row.endsAt ? formatTime(row.endsAt) : "";
  return end
    ? `${day} · ${formatTime(row.startsAt)}–${end}`
    : `${day} · ${formatTime(row.startsAt)}`;
}

export function eventFacts(
  row: EventPreviewRow,
  ctx: Pick<ResolveContext, "now">,
  level: ReferenceLevel,
): ReferenceFacts {
  const facts: ReferenceFacts = {
    kind: "event",
    title: row.title.trim() || "Untitled event",
    lead: { kind: "icon", type: "event" },
    fact: null,
    card: null,
  };
  if (level === "chip") return facts;
  const meta: ReferenceMeta[] = [];
  const when = eventWhen(row, ctx.now());
  if (when) meta.push({ key: "when", text: when, icon: "due" });
  if (row.attendeeCount > 0) {
    meta.push({
      key: "people",
      text: `${row.attendeeCount} ${row.attendeeCount === 1 ? "person" : "people"}`,
      icon: "people",
    });
  }
  facts.card = { meta };
  return facts;
}

const resolveEvents: Resolver = async (ctx, ids, level) => {
  const rows = await ctx.previews.events({ workspaceId: ctx.workspaceId, ids });
  return answer(ids, rows, (row) => eventFacts(row, ctx, level));
};

// ── contact / company ────────────────────────────────────────────────────────

export function contactFacts(row: ContactPreviewRow, level: ReferenceLevel): ReferenceFacts {
  const name = row.name.trim() || (row.kind === "company" ? "Untitled company" : "Unnamed contact");
  const facts: ReferenceFacts = {
    kind: row.kind,
    title: name,
    lead:
      row.kind === "company"
        ? { kind: "icon", type: "company" }
        : { kind: "person", person: { name, id: row.id, avatarUrl: row.avatarUrl } },
    fact: null,
    card: null,
  };
  if (level === "chip") return facts;
  const meta: ReferenceMeta[] = [];
  const role = [row.role?.trim(), row.companyName?.trim()].filter(Boolean).join(" · ");
  if (role) meta.push({ key: "role", text: role });
  if (row.email) meta.push({ key: "email", text: row.email, icon: "mail" });
  facts.card = { meta };
  return facts;
}

function contactResolver(kind: "contact" | "company"): Resolver {
  return async (ctx, ids, level) => {
    const rows = await ctx.previews.contacts({ workspaceId: ctx.workspaceId, ids, kind });
    return answer(ids, rows, (row) => contactFacts(row, level));
  };
}

// ── email ────────────────────────────────────────────────────────────────────

export function emailFacts(
  row: EmailPreviewRow,
  ctx: Pick<ResolveContext, "now">,
  level: ReferenceLevel,
): ReferenceFacts {
  const facts: ReferenceFacts = {
    kind: "email",
    title: row.subject.trim() || "(no subject)",
    lead: { kind: "icon", type: "email" },
    fact: null,
    card: null,
  };
  if (level === "chip") return facts;
  const sender = row.fromName?.trim() || row.fromAddr?.trim() || "";
  facts.card = {
    overline: sender
      ? {
          person: { name: sender, id: row.fromAddr, avatarUrl: null },
          text: sender,
          trailing: row.sentAt ? formatDate(row.sentAt, ctx.now()) : null,
        }
      : null,
    excerpt: row.snippet?.trim() || null,
    meta: row.waitingOnReply ? [{ key: "waiting", text: "Waiting on reply", icon: "waiting" }] : [],
  };
  return facts;
}

const resolveEmails: Resolver = async (ctx, ids, level) => {
  const rows = await ctx.previews.emails({ workspaceId: ctx.workspaceId, ids });
  return answer(ids, rows, (row) => emailFacts(row, ctx, level));
};

// ── tag ──────────────────────────────────────────────────────────────────────

export function tagFacts(row: TagPreviewRow): ReferenceFacts {
  return {
    kind: "tag",
    title: row.name.trim() || "tag",
    lead: { kind: "dot", color: row.color },
    fact: null,
    card: null,
  };
}

const resolveTags: Resolver = async (ctx, ids) => {
  const rows = await ctx.previews.tags({ workspaceId: ctx.workspaceId, ids });
  return answer(ids, rows, (row) => tagFacts(row));
};

// ── anything else in the registry ────────────────────────────────────────────

/** A registry type without its own resolver: its label, under the registry's RLS. */
const resolveOther: Resolver = async (ctx, ids, _level, type) => {
  const out = new Map<string, ReferenceResolution>();
  if (!ctx.getEntities) {
    for (const id of ids) out.set(id, { status: "private" });
    return out;
  }
  const records = await ctx.getEntities(ids.map((id) => ({ type, id })));
  const rows = records
    .filter((r) => r.type === type)
    .map((r) => ({ id: r.id, deletedAt: r.deletedAt, label: r.label }));
  return answer(ids, rows, (row) => ({
    kind: "other",
    title: row.label.trim() || "Untitled",
    lead: { kind: "icon", type },
    fact: null,
    card: { meta: [] },
  }));
};

// ── the registry ─────────────────────────────────────────────────────────────

const RESOLVERS = new Map<ReferenceKind, Resolver>([
  ["task", resolveTasks],
  ["project", resolveProjects],
  ["note", resolveNotes],
  ["event", resolveEvents],
  ["contact", contactResolver("contact")],
  ["company", contactResolver("company")],
  ["email", resolveEmails],
  ["tag", resolveTags],
  ["other", resolveOther],
]);

/**
 * Register (or replace) a kind's resolver. Modules own their previews (55):
 * a rebuilt module can replace the baseline here without touching the store.
 */
export function registerReferenceResolver(kind: ReferenceKind, resolver: Resolver): void {
  RESOLVERS.set(kind, resolver);
}

/** The resolver for a kind (every kind has one; `other` reads the registry). */
export function resolverFor(kind: ReferenceKind): Resolver {
  return RESOLVERS.get(kind) ?? resolveOther;
}
