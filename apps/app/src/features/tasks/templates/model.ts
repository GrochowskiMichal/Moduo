// Templates and "Duplicate project…" (Tasks v3 §15, TV-D15; REPLAN 9 and 79).
//
// A template is a saved copy of the work, never of a run of it. Its body is
// what the server read from the task or project (`*_templates__body_of` in
// 20261013160000_templates.sql): positions instead of row ids for its own
// statuses, sections, tasks and parents, and dates as offsets in days. The
// app edits the body as data (the template is its own editor) and the server
// checks every write of it. Pure: no runtime, no React.

import {
  normalizeTemplateKind,
  normalizeTemplateLinkType,
  TASK_STATUS_CATEGORIES,
  type TaskStatusCategory,
  type TemplateKind,
  type TemplateLinkType,
} from "@contracts/vocabularies";
import type { EnergyLevel, PriorityLevel } from "../model";

export type { TemplateKind } from "@contracts/vocabularies";

export type TemplateTag = { id: string | null; name: string; color: string | null };
export type TemplateLink = { type: TemplateLinkType; id: string };

/** One task in a body. `parent`, `status` and `section` are positions in the body. */
export type TemplateTask = {
  title: string;
  description: string;
  parent: number | null;
  /** Project templates only: a position in `statuses`. */
  status?: number | null;
  /** Project templates only: a position in `sections`. */
  section?: number | null;
  position: string | null;
  priority: PriorityLevel | null;
  energy: EnergyLevel | null;
  estimate: number | null;
  /** Days from the template's start (or due date). */
  due: number | null;
  /** HH:MM, with a due date only. */
  due_time: string | null;
  assignee: string | null;
  team: string | null;
  tags: TemplateTag[];
  links: TemplateLink[];
};

export type TaskTemplateBody = {
  v: 1;
  kind: "task";
  /** "due": dates count from the task's due date; "start": from the day it's made. */
  anchor: "due" | "start";
  project: string | null;
  section: string | null;
  tasks: TemplateTask[];
  relations: Array<[number, number]>;
};

export type TemplateStatus = { category: TaskStatusCategory; name: string; hidden: boolean };
export type TemplateSection = { name: string; starts: number | null; ends: number | null };

export type ProjectTemplateBody = {
  v: 1;
  kind: "project";
  name: string;
  description: string;
  color: string | null;
  starts: number | null;
  target: number | null;
  statuses: TemplateStatus[];
  sections: TemplateSection[];
  tasks: TemplateTask[];
  relations: Array<[number, number]>;
};

export type TemplateBody = TaskTemplateBody | ProjectTemplateBody;

/** What a list shows without reading a body (`templates__summary`). */
export type TemplateFacts = {
  tasks: number;
  /** Top-level tasks (the rest are subtasks). */
  top: number;
  sections: number;
  /** It has dates: applying it asks for a start. */
  dated: boolean;
  /** Someone is assigned in it. */
  people: boolean;
  anchor: "due" | "start" | null;
  /** A task template's task title. */
  title: string | null;
  /** A task template's own project (where it goes unless you pick another). */
  project: string | null;
};

export type Template = {
  id: string;
  kind: TemplateKind;
  workspaceId: string;
  ownerId: string;
  name: string;
  shared: boolean;
  /** Saved from a project the workspace can't see. */
  privateSource: boolean;
  /** Its maker had Full access to what it copied: only then can it be shared. */
  shareable: boolean;
  facts: TemplateFacts;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TemplateWithBody = Template & { body: TemplateBody };

/** What a template op changes (`templates_op_update`): only the keys given. */
export type TemplatePatchable = {
  name?: string;
  shared?: boolean;
  body?: TemplateBody;
  /** true deletes (Undo-able for 30 days), false restores. */
  deleted?: boolean;
};

// ── Reading rows ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
const bool = (v: unknown): boolean => v === true;
const PRIORITIES: readonly PriorityLevel[] = ["low", "medium", "high"];
const ENERGIES: readonly EnergyLevel[] = ["low", "medium", "high"];

export function templateFactsOf(raw: unknown): TemplateFacts {
  const r = (raw && typeof raw === "object" ? raw : {}) as Row;
  const anchor = r.anchor === "due" || r.anchor === "start" ? r.anchor : null;
  return {
    tasks: num(r.tasks) ?? 0,
    top: num(r.top) ?? 0,
    sections: num(r.sections) ?? 0,
    dated: bool(r.dated),
    people: bool(r.people),
    anchor,
    title: str(r.title),
    project: str(r.project),
  };
}

/** A template row (either table) as the app holds it; null when unreadable. */
export function templateFromRow(raw: unknown, kindHint?: TemplateKind): Template | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Row;
  const kind = normalizeTemplateKind(r.kind) ?? kindHint ?? null;
  const id = str(r.id);
  const workspaceId = str(r.workspace_id);
  const ownerId = str(r.owner_id);
  const name = str(r.name);
  if (!kind || !id || !workspaceId || !ownerId || name === null) return null;
  return {
    id,
    kind,
    workspaceId,
    ownerId,
    name,
    shared: bool(r.shared),
    privateSource: bool(r.private_source),
    shareable: bool(r.shareable),
    facts: templateFactsOf(r.summary),
    createdAt: str(r.created_at) ?? "",
    updatedAt: str(r.updated_at) ?? "",
    deletedAt: str(r.deleted_at),
  };
}

function taskOf(raw: unknown): TemplateTask {
  const r = (raw && typeof raw === "object" ? raw : {}) as Row;
  const tags = Array.isArray(r.tags) ? r.tags : [];
  const links = Array.isArray(r.links) ? r.links : [];
  const priority = PRIORITIES.find((p) => p === r.priority) ?? null;
  const energy = ENERGIES.find((e) => e === r.energy) ?? null;
  const task: TemplateTask = {
    title: str(r.title) ?? "",
    description: str(r.description) ?? "",
    parent: num(r.parent),
    position: str(r.position),
    priority,
    energy,
    estimate: num(r.estimate),
    due: num(r.due),
    due_time: str(r.due_time),
    assignee: str(r.assignee),
    team: str(r.team),
    tags: tags.flatMap((t) => {
      const g = (t && typeof t === "object" ? t : {}) as Row;
      const name = str(g.name);
      return name ? [{ id: str(g.id), name, color: str(g.color) }] : [];
    }),
    links: links.flatMap((l) => {
      const x = (l && typeof l === "object" ? l : {}) as Row;
      const type = normalizeTemplateLinkType(x.type);
      const id = str(x.id);
      return type && id ? [{ type, id }] : [];
    }),
  };
  if ("status" in r) task.status = num(r.status);
  if ("section" in r) task.section = num(r.section);
  return task;
}

function relationsOf(raw: unknown): Array<[number, number]> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) return [];
    const a = num(pair[0]);
    const b = num(pair[1]);
    return a !== null && b !== null ? [[a, b] as [number, number]] : [];
  });
}

/** A body as the app edits it (lenient: what it can't read is left out). */
export function templateBodyOf(raw: unknown, kind: TemplateKind): TemplateBody {
  const r = (raw && typeof raw === "object" ? raw : {}) as Row;
  const tasks = Array.isArray(r.tasks) ? r.tasks.map(taskOf) : [];
  const relations = relationsOf(r.relations);
  if (kind === "task") {
    return {
      v: 1,
      kind: "task",
      anchor: r.anchor === "due" ? "due" : "start",
      project: str(r.project),
      section: str(r.section),
      tasks,
      relations,
    };
  }
  const statuses = Array.isArray(r.statuses) ? r.statuses : [];
  const sections = Array.isArray(r.sections) ? r.sections : [];
  return {
    v: 1,
    kind: "project",
    name: str(r.name) ?? "",
    description: str(r.description) ?? "",
    color: str(r.color),
    starts: num(r.starts),
    target: num(r.target),
    statuses: statuses.flatMap((s) => {
      const x = (s && typeof s === "object" ? s : {}) as Row;
      const category = TASK_STATUS_CATEGORIES.find((c) => c === x.category);
      const name = str(x.name);
      return category && name ? [{ category, name, hidden: bool(x.hidden) }] : [];
    }),
    sections: sections.map((s) => {
      const x = (s && typeof s === "object" ? s : {}) as Row;
      return { name: str(x.name) ?? "", starts: num(x.starts), ends: num(x.ends) };
    }),
    tasks,
    relations,
  };
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** YYYY-MM-DD plus some days, on the calendar (no time zone involved). */
export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * An offset in words: "On the start", "3 days after the start", "1 day
 * before the due date". `from` names what it counts from.
 */
export function offsetLabel(days: number | null, from: "start" | "due"): string {
  if (days === null) return "No date";
  const what = from === "due" ? "the due date" : "the start";
  if (days === 0) return from === "due" ? "On the due date" : "On the start";
  const n = Math.abs(days);
  return `${n} ${n === 1 ? "day" : "days"} ${days > 0 ? "after" : "before"} ${what}`;
}

// ── Names ───────────────────────────────────────────────────────────────────

/** The name a copy starts with: "Season 1" → "Season 1 (copy)". */
export function copyName(name: string): string {
  const trimmed = name.trim();
  const out = `${trimmed} (copy)`;
  return out.length <= 120 ? out : `${trimmed.slice(0, 113).trimEnd()} (copy)`;
}

/** What a template holds, in a few words: "12 tasks · 3 sections". */
export function templateSize(t: Pick<Template, "kind" | "facts">): string {
  const parts: string[] = [];
  if (t.kind === "task") {
    const subs = Math.max(0, t.facts.tasks - 1);
    parts.push(subs === 0 ? "No subtasks" : `${subs} ${subs === 1 ? "subtask" : "subtasks"}`);
  } else {
    parts.push(`${t.facts.tasks} ${t.facts.tasks === 1 ? "task" : "tasks"}`);
    if (t.facts.sections > 0) {
      parts.push(`${t.facts.sections} ${t.facts.sections === 1 ? "section" : "sections"}`);
    }
  }
  return parts.join(" · ");
}

// ── Editing a body (the template is its own editor) ─────────────────────────

const blankTask = (parent: number | null): TemplateTask => ({
  title: "",
  description: "",
  parent,
  position: null,
  priority: null,
  energy: null,
  estimate: null,
  due: null,
  due_time: null,
  assignee: null,
  team: null,
  tags: [],
  links: [],
});

/** Change one task's fields. */
export function patchTemplateTask<B extends TemplateBody>(
  body: B,
  index: number,
  patch: Partial<TemplateTask>,
): B {
  if (!body.tasks[index]) return body;
  const tasks = body.tasks.map((t, i) => {
    if (i !== index) return t;
    const next = { ...t, ...patch };
    // A due time only goes with a due date.
    if (next.due === null) next.due_time = null;
    return next;
  });
  return { ...body, tasks };
}

/**
 * Add a task (at the end of the top level, or as the last subtask of
 * `parent`). Subtasks come after every top-level task, so a parent always
 * comes first; positions in the body are renumbered to keep that.
 */
export function addTemplateTask<B extends TemplateBody>(
  body: B,
  opts: { title: string; parent?: number | null; section?: number | null },
): B {
  const parent = opts.parent ?? null;
  const task = { ...blankTask(parent), title: opts.title };
  if (body.kind === "project") {
    task.status = null;
    task.section = parent === null ? (opts.section ?? null) : null;
  }
  // Insert after the parent's last subtask (or at the end of the top level).
  let at = body.tasks.length;
  if (parent === null) {
    const firstSub = body.tasks.findIndex((t) => t.parent !== null);
    at = firstSub === -1 ? body.tasks.length : firstSub;
  } else {
    let last = parent;
    body.tasks.forEach((t, i) => {
      if (t.parent === parent) last = i;
    });
    at = last + 1;
  }
  const tasks = [...body.tasks.slice(0, at), task, ...body.tasks.slice(at)];
  // Everything at or past `at` moved one down.
  const shift = (i: number) => (i >= at ? i + 1 : i);
  return {
    ...body,
    tasks: tasks.map((t, i) =>
      i === at || t.parent === null ? t : { ...t, parent: shift(t.parent) },
    ),
    relations: body.relations.map(([a, b]) => [shift(a), shift(b)] as [number, number]),
  };
}

/** Remove a task and its subtasks; every position after them closes up. */
export function removeTemplateTask<B extends TemplateBody>(body: B, index: number): B {
  if (!body.tasks[index]) return body;
  // The task itself is never a task template's own task (index 0).
  if (body.kind === "task" && index === 0) return body;
  const gone = new Set<number>([index]);
  body.tasks.forEach((t, i) => {
    if (t.parent === index) gone.add(i);
  });
  const map = new Map<number, number>();
  let n = 0;
  body.tasks.forEach((_, i) => {
    if (!gone.has(i)) map.set(i, n++);
  });
  return {
    ...body,
    tasks: body.tasks
      .filter((_, i) => !gone.has(i))
      .map((t) => (t.parent === null ? t : { ...t, parent: map.get(t.parent) ?? null })),
    relations: body.relations.flatMap(([a, b]) => {
      const x = map.get(a);
      const y = map.get(b);
      return x === undefined || y === undefined ? [] : [[x, y] as [number, number]];
    }),
  };
}

/** Project templates: add a section at the end. */
export function addTemplateSection(body: ProjectTemplateBody, name: string): ProjectTemplateBody {
  return { ...body, sections: [...body.sections, { name, starts: null, ends: null }] };
}

/** Project templates: change a section (a start needs an end after it). */
export function patchTemplateSection(
  body: ProjectTemplateBody,
  index: number,
  patch: Partial<TemplateSection>,
): ProjectTemplateBody {
  return {
    ...body,
    sections: body.sections.map((s, i) => {
      if (i !== index) return s;
      const next = { ...s, ...patch };
      if (next.ends === null) next.starts = null;
      if (next.starts !== null && next.ends !== null && next.starts > next.ends) {
        next.starts = next.ends;
      }
      return next;
    }),
  };
}

/** Project templates: remove a section; its tasks stay, without a section. */
export function removeTemplateSection(
  body: ProjectTemplateBody,
  index: number,
): ProjectTemplateBody {
  return {
    ...body,
    sections: body.sections.filter((_, i) => i !== index),
    tasks: body.tasks.map((t) => {
      if (t.section === undefined || t.section === null) return t;
      if (t.section === index) return { ...t, section: null };
      return t.section > index ? { ...t, section: t.section - 1 } : t;
    }),
  };
}

/** Project templates: rename a status (names stay unique in the set). */
export function renameTemplateStatus(
  body: ProjectTemplateBody,
  index: number,
  name: string,
): ProjectTemplateBody {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 60) return body;
  const taken = body.statuses.some(
    (s, i) => i !== index && s.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (taken) return body;
  return {
    ...body,
    statuses: body.statuses.map((s, i) => (i === index ? { ...s, name: trimmed } : s)),
  };
}

/** The tasks of a body in the order an editor lists them: each parent, then its subtasks. */
export function templateOutline(
  body: TemplateBody,
): Array<{ index: number; task: TemplateTask; depth: 0 | 1 }> {
  const out: Array<{ index: number; task: TemplateTask; depth: 0 | 1 }> = [];
  body.tasks.forEach((task, index) => {
    if (task.parent !== null) return;
    out.push({ index, task, depth: 0 });
    body.tasks.forEach((sub, j) => {
      if (sub.parent === index) out.push({ index: j, task: sub, depth: 1 });
    });
  });
  return out;
}
