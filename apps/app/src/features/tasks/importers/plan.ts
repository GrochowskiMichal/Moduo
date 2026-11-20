// What an export file becomes before anything is written (TV-U18, spec §15,
// REPLAN 35): one plan per file — projects with their sections, the statuses
// their tasks use, and the tasks in order (a parent before its subtasks) —
// plus what was left out and why. The readers (todoist.ts, trello.ts,
// linear.ts, jira.ts, asana.ts) make plans; the preview shows one; the run
// (run.ts) writes it through the import engine. Nothing here touches the
// network.

import type { PriorityLevel, TaskStatusCategory } from "@contracts/vocabularies";

import type { RecurrenceRule } from "../model";

export type ImportSource = "todoist" | "trello" | "linear" | "jira" | "asana";

/** The services, in the order call 35 names them. */
export const IMPORT_SOURCES: ReadonlyArray<{
  id: ImportSource;
  label: string;
  /** What to export there, in a few words. */
  file: string;
  accept: string;
}> = [
  { id: "todoist", label: "Todoist", file: "a project exported as CSV", accept: ".csv" },
  { id: "trello", label: "Trello", file: "a board exported as JSON", accept: ".json" },
  { id: "linear", label: "Linear", file: "issues exported as CSV", accept: ".csv" },
  { id: "jira", label: "Jira", file: "issues exported as CSV (all fields)", accept: ".csv" },
  { id: "asana", label: "Asana", file: "a project exported as CSV", accept: ".csv" },
];

export const sourceLabel = (id: ImportSource) =>
  IMPORT_SOURCES.find((s) => s.id === id)?.label ?? id;

/** The biggest file read (a Trello board with its history runs large). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** The most tasks (subtasks included) one import writes. */
export const IMPORT_MAX_TASKS = 2000;
/** The most comments kept on one task; older ones beyond it are left out. */
export const IMPORT_MAX_COMMENTS = 20;

/** The server's limits on what a task carries. */
const KEY_MAX = 200;
const TITLE_MAX = 500;
const DESCRIPTION_MAX = 20000;
const NAME_MAX = 120;

export type PlanStatus = {
  /** The source's own name for it ("In review", a Trello list). */
  name: string;
  category: TaskStatusCategory;
};

/**
 * Someone an export names, in its own words. Matched in the app against what
 * the member list already shows the person importing (names, their own
 * email), never looked up on the server; the preview asks for the rest.
 */
export type PlanPerson = { name: string | null; email: string | null };

export type PlanComment = {
  author: string | null;
  /** YYYY-MM-DD, when the export says. */
  on: string | null;
  text: string;
};

export type PlanTask = {
  /** The "imported from" key: the source's own id where it has one. */
  key: string;
  parentKey: string | null;
  title: string;
  description: string;
  section: string | null;
  /** A name from the project's `statuses`; null: the category's first status. */
  status: string | null;
  category: TaskStatusCategory;
  dueOn: string | null;
  /** HH:MM, the wall clock it was due at. */
  dueTime: string | null;
  recurrence: RecurrenceRule | null;
  priority: PriorityLevel | null;
  /** In minutes, when the export gives time (not points). */
  estimateMinutes: number | null;
  tags: string[];
  /** Who the export says is on it, in its own words; null: nobody. */
  assignee: PlanPerson | null;
  comments: PlanComment[];
};

export type PlanProject = {
  /** The project's name in the source, as the plan knows it. */
  name: string;
  description: string;
  /** Section names, in order. */
  sections: string[];
  /** The statuses the tasks use, in order ([] when the tasks use categories). */
  statuses: PlanStatus[];
  /** Parents before their subtasks, in the export's order. */
  tasks: PlanTask[];
};

export type SkipReason = "archived" | "untitled" | "finished" | "over_limit" | "parent_left_out";

export type NoteKind =
  /** A repeat Moduo can't keep: written into the description. */
  | "repeat_as_text"
  /** A date the reader couldn't read: written into the description. */
  | "date_as_text"
  /** Start dates have no place on a task (spec §15). */
  | "start_dropped"
  /** Subtasks of subtasks became subtasks of the top task (call 28). */
  | "flattened"
  /** Estimates in points, not time. */
  | "estimate_dropped"
  /** Comments beyond IMPORT_MAX_COMMENTS on a task. */
  | "comments_dropped"
  /** Attachments stay in the source. */
  | "attachments_dropped"
  /** Jira epics became sections; their own text and comments stay in Jira. */
  | "epic_as_section";

export type ImportPlan = {
  source: ImportSource;
  /** The run's name: the file's, or the board's. */
  label: string;
  projects: PlanProject[];
  skipped: Partial<Record<SkipReason, number>>;
  notes: Partial<Record<NoteKind, number>>;
};

export function emptyPlan(source: ImportSource, label: string): ImportPlan {
  return {
    source,
    label: clip(label, NAME_MAX) || sourceLabel(source),
    projects: [],
    skipped: {},
    notes: {},
  };
}

export function bump<K extends string>(into: Partial<Record<K, number>>, kind: K, by = 1) {
  if (by <= 0) return;
  into[kind] = (into[kind] ?? 0) + by;
}

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const clipTitle = (t: string) => clip(t.replace(/\s+/g, " "), TITLE_MAX);
export const clipName = (t: string) => clip(t.replace(/\s+/g, " "), NAME_MAX);
export const clipDescription = (t: string) => clip(t, DESCRIPTION_MAX);

/** A source id as an import key (kept to the server's 200 characters). */
export function keyOf(value: string): string {
  const v = value.trim();
  return v.length <= KEY_MAX ? v : `${v.slice(0, KEY_MAX - 13)}#${hashText(v)}`;
}

/** A short, stable hash (two FNV-1a passes, 12 hex digits). */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x01000193) >>> 0;
  }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 12);
}

/** Find or add a project by name (any case). */
export function projectNamed(plan: ImportPlan, name: string): PlanProject {
  const n = clipName(name) || "Imported";
  const found = plan.projects.find((p) => p.name.toLowerCase() === n.toLowerCase());
  if (found) return found;
  const made: PlanProject = { name: n, description: "", sections: [], statuses: [], tasks: [] };
  plan.projects.push(made);
  return made;
}

/** Add a section name once (any case); answers the name as kept. */
export function addSection(project: PlanProject, name: string): string | null {
  const n = clipName(name);
  if (!n) return null;
  const found = project.sections.find((s) => s.toLowerCase() === n.toLowerCase());
  if (found) return found;
  project.sections.push(n);
  return n;
}

/** Add a status once (any case); answers the name as kept. */
export function addStatus(
  project: PlanProject,
  name: string,
  category: TaskStatusCategory,
): string | null {
  const n = clipName(name);
  if (!n) return null;
  const found = project.statuses.find((s) => s.name.toLowerCase() === n.toLowerCase());
  if (found) return found.name;
  project.statuses.push({ name: n, category });
  return n;
}

/** A task with every field empty but the ones given. */
export function planTask(fields: Partial<PlanTask> & Pick<PlanTask, "key" | "title">): PlanTask {
  return {
    parentKey: null,
    description: "",
    section: null,
    status: null,
    category: "todo",
    dueOn: null,
    dueTime: null,
    recurrence: null,
    priority: null,
    estimateMinutes: null,
    tags: [],
    assignee: null,
    comments: [],
    ...fields,
    title: clipTitle(fields.title),
    key: keyOf(fields.key),
  };
}

// ── priorities ──────────────────────────────────────────────────────────────

/**
 * A source's priority word on Moduo's three levels (no Urgent, spec §2).
 * A level with no match of its own (Urgent, Highest, Lowest) also keeps its
 * word as a tag, so nothing the source said is lost (agent's choice).
 */
export function priorityOf(word: string): { priority: PriorityLevel | null; tag: string | null } {
  const w = word.trim().toLowerCase();
  switch (w) {
    case "urgent":
    case "highest":
    case "critical":
    case "blocker":
      return { priority: "high", tag: w };
    case "high":
      return { priority: "high", tag: null };
    case "medium":
    case "normal":
      return { priority: "medium", tag: null };
    case "low":
      return { priority: "low", tag: null };
    case "lowest":
    case "trivial":
      return { priority: "low", tag: w };
    default:
      return { priority: null, tag: null };
  }
}

// ── statuses ────────────────────────────────────────────────────────────────

/** A category from a status's name, when the name says it. */
export function categoryFromName(name: string): TaskStatusCategory | null {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[\s'’_-]+/g, "");
  if (["backlog", "icebox", "someday", "ideas", "triage", "later"].includes(n)) return "backlog";
  if (
    [
      "todo",
      "open",
      "new",
      "unstarted",
      "selectedfordevelopment",
      "ready",
      "next",
      "planned",
    ].includes(n)
  )
    return "todo";
  if (
    n.startsWith("inprogress") ||
    n.startsWith("doing") ||
    n.startsWith("inreview") ||
    n.startsWith("review") ||
    ["started", "active", "working", "blocked", "testing", "qa"].includes(n)
  )
    return "in_progress";
  if (
    [
      "done",
      "complete",
      "completed",
      "closed",
      "resolved",
      "shipped",
      "released",
      "finished",
    ].includes(n)
  )
    return "done";
  if (
    ["canceled", "cancelled", "wontdo", "wontfix", "duplicate", "rejected", "declined"].includes(n)
  )
    return "wont_do";
  return null;
}

// ── shaping ─────────────────────────────────────────────────────────────────

/**
 * Subtasks stay one level (call 28): a subtask of a subtask becomes a subtask
 * of the top task, and a subtask whose parent isn't in the file becomes a
 * task of its own. Parents are put before their subtasks, the export's order
 * kept otherwise. A subtask lives where its parent does.
 */
export function shapeProjectTasks(plan: ImportPlan, project: PlanProject) {
  const byKey = new Map(project.tasks.map((t) => [t.key, t]));
  const topOf = (task: PlanTask): PlanTask => {
    let cur = task;
    const seen = new Set<string>();
    while (cur.parentKey && byKey.has(cur.parentKey) && !seen.has(cur.key)) {
      seen.add(cur.key);
      cur = byKey.get(cur.parentKey)!;
    }
    return cur;
  };
  for (const task of project.tasks) {
    if (!task.parentKey) continue;
    if (!byKey.has(task.parentKey)) {
      task.parentKey = null;
      continue;
    }
    const top = topOf(task);
    if (top.key === task.key) {
      task.parentKey = null;
      continue;
    }
    if (top.key !== task.parentKey) bump(plan.notes, "flattened");
    task.parentKey = top.key;
    task.section = top.section;
  }
  const children = new Map<string, PlanTask[]>();
  for (const t of project.tasks) {
    if (t.parentKey) children.set(t.parentKey, [...(children.get(t.parentKey) ?? []), t]);
  }
  project.tasks = project.tasks
    .filter((t) => !t.parentKey)
    .flatMap((t) => [t, ...(children.get(t.key) ?? [])]);
}

/**
 * A subtask lives where its parent does: one whose parent landed in another
 * project (another Linear project, or Jira's) moves to the parent's.
 */
export function moveSubtasksToParents(plan: ImportPlan) {
  const home = new Map<string, PlanProject>();
  for (const p of plan.projects) for (const t of p.tasks) home.set(t.key, p);
  for (const p of plan.projects) {
    const moving = p.tasks.filter(
      (t) => t.parentKey && home.has(t.parentKey) && home.get(t.parentKey) !== p,
    );
    if (!moving.length) continue;
    p.tasks = p.tasks.filter((t) => !moving.includes(t));
    for (const t of moving) {
      const target = home.get(t.parentKey!)!;
      // Its status keeps its category in the new home.
      if (t.status) {
        const s = p.statuses.find((x) => x.name === t.status);
        t.status = s ? addStatus(target, s.name, s.category) : null;
      }
      target.tasks.push(t);
      home.set(t.key, target);
    }
  }
}

/** Every task of a plan, projects in order. */
export function planTasks(plan: ImportPlan): PlanTask[] {
  return plan.projects.flatMap((p) => p.tasks);
}

export type PlanChoice = {
  /** Bring tasks that are done or won't do in the source. */
  includeFinished: boolean;
  /** The category each status ends up in (the preview confirms Trello's lists). */
  categories?: Record<string, Record<string, TaskStatusCategory>>;
};

/**
 * The plan as it will be written: finished tasks left out unless chosen, the
 * statuses' confirmed categories applied, and the task limit kept (the first
 * IMPORT_MAX_TASKS in the export's order). Pure: the preview and the run
 * read the same answer.
 */
export function choosePlan(plan: ImportPlan, choice: PlanChoice): ImportPlan {
  const skipped = { ...plan.skipped };
  let kept = 0;
  const projects = plan.projects.map((project) => {
    const confirmed = choice.categories?.[project.name] ?? {};
    const statuses = project.statuses.map((s) => ({
      ...s,
      category: confirmed[s.name] ?? s.category,
    }));
    const categoryOf = new Map(statuses.map((s) => [s.name, s.category]));
    const out: PlanTask[] = [];
    const left = new Set<string>();
    for (const t of project.tasks) {
      const category = t.status ? (categoryOf.get(t.status) ?? t.category) : t.category;
      if (t.parentKey && left.has(t.parentKey)) {
        left.add(t.key);
        bump(skipped, "parent_left_out");
        continue;
      }
      if (!choice.includeFinished && (category === "done" || category === "wont_do")) {
        left.add(t.key);
        bump(skipped, "finished");
        continue;
      }
      if (kept >= IMPORT_MAX_TASKS) {
        left.add(t.key);
        bump(skipped, "over_limit");
        continue;
      }
      kept += 1;
      out.push({ ...t, category });
    }
    const used = new Set(out.map((t) => t.status).filter(Boolean));
    return { ...project, statuses: statuses.filter((s) => used.has(s.name)), tasks: out };
  });
  return { ...plan, projects: projects.filter((p) => p.tasks.length > 0), skipped };
}

/** How many tasks a plan's file has that are finished (for the preview's switch). */
export function finishedCount(plan: ImportPlan): number {
  return planTasks(plan).filter((t) => t.category === "done" || t.category === "wont_do").length;
}

const SKIP_WORDS: Record<SkipReason, (n: number) => string> = {
  archived: (n) => `${n} archived in the source`,
  untitled: (n) => `${n} without a title`,
  finished: (n) => `${n} finished`,
  over_limit: (n) => `${n} over the ${IMPORT_MAX_TASKS.toLocaleString("en-US")}-task limit`,
  parent_left_out: (n) => `${n} whose parent was left out`,
};

/** "12 archived in the source · 3 finished", in a fixed order. */
export function describeSkips(skipped: ImportPlan["skipped"]): string[] {
  return (Object.keys(SKIP_WORDS) as SkipReason[])
    .filter((k) => (skipped[k] ?? 0) > 0)
    .map((k) => SKIP_WORDS[k](skipped[k]!));
}

export function skippedTotal(skipped: ImportPlan["skipped"]): number {
  return Object.values(skipped).reduce((a, n) => a + (n ?? 0), 0);
}

const NOTE_WORDS: Record<NoteKind, (n: number) => string> = {
  repeat_as_text: (n) =>
    `${n} ${n === 1 ? "repeat" : "repeats"} Moduo can't follow, kept as text in the description`,
  date_as_text: (n) =>
    `${n} ${n === 1 ? "date" : "dates"} we couldn't read, kept as text in the description`,
  start_dropped: (n) =>
    `${n} start ${n === 1 ? "date" : "dates"} left out (tasks have a due date only)`,
  flattened: (n) => `${n} deeper ${n === 1 ? "subtask" : "subtasks"} moved up to one level`,
  estimate_dropped: (n) => `${n} ${n === 1 ? "estimate" : "estimates"} in points left out`,
  comments_dropped: (n) =>
    `${n} older ${n === 1 ? "comment" : "comments"} left out (${IMPORT_MAX_COMMENTS} kept per task)`,
  attachments_dropped: (n) =>
    `${n} ${n === 1 ? "attachment stays" : "attachments stay"} in the source`,
  epic_as_section: (n) =>
    `${n} ${n === 1 ? "epic became a section" : "epics became sections"} (an epic's own description and comments stay in Jira)`,
};

/** The plan's notes as sentences, in a fixed order. */
export function describeNotes(notes: ImportPlan["notes"]): string[] {
  return (Object.keys(NOTE_WORDS) as NoteKind[])
    .filter((k) => (notes[k] ?? 0) > 0)
    .map((k) => NOTE_WORDS[k](notes[k]!));
}

/**
 * A due date as the file wrote it: the date when it reads, else the words
 * kept at the end of the description ("Due in Jira: 24.10.2026") and
 * counted, never dropped silently.
 */
export function dueOrText(
  plan: ImportPlan,
  raw: string,
  read: (v: string) => string | null,
  description: string,
): { dueOn: string | null; description: string } {
  const v = raw.trim();
  if (!v) return { dueOn: null, description };
  const day = read(v);
  if (day) return { dueOn: day, description };
  bump(plan.notes, "date_as_text");
  const line = `Due in ${sourceLabel(plan.source)}: ${v}`;
  return {
    dueOn: null,
    description: clipDescription(description ? `${description}\n\n${line}` : line),
  };
}

/** Keep the last IMPORT_MAX_COMMENTS comments of a task; count the rest. */
export function keepComments(plan: ImportPlan, comments: PlanComment[]): PlanComment[] {
  if (comments.length <= IMPORT_MAX_COMMENTS) return comments;
  bump(plan.notes, "comments_dropped", comments.length - IMPORT_MAX_COMMENTS);
  return comments.slice(comments.length - IMPORT_MAX_COMMENTS);
}

/** Tag names: trimmed, without "#" or "@", once each (any case). */
export function cleanTags(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    // A tag's name is at most 50 characters (tasks_op_tag).
    const n = clip(raw.replace(/^[#@]+/, "").replace(/\s+/g, " "), 50);
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out.slice(0, 20);
}

/** An email, when the value looks like one (lower case). */
export function emailIn(value: string): string | null {
  const m = /[^\s<>(),;"]+@[^\s<>(),;"]+\.[a-z]{2,}/i.exec(value);
  return m ? m[0].toLowerCase() : null;
}

/** A person from an export's cells: a name, an email, or both ("Ana <ana@x.io>"). */
export function personFrom(name: string, email = ""): PlanPerson | null {
  const mail = emailIn(email) ?? emailIn(name);
  let words = name.replace(/<[^>]*>/g, " ");
  if (mail)
    words = words.replace(new RegExp(mail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  words = words.replace(/\s+/g, " ").trim();
  const n = words ? clipName(words) : null;
  return n || mail ? { name: n || null, email: mail } : null;
}

/** One key per person in a file: their email, else their name (any case). */
export function personKey(p: PlanPerson): string {
  return (p.email ?? p.name ?? "").toLowerCase();
}

/** How the preview names them: "Maya Chen · maya@example.com". */
export function personLabel(p: PlanPerson): string {
  return [p.name, p.email].filter(Boolean).join(" · ") || "Someone";
}

export type FilePerson = { key: string; label: string; person: PlanPerson; tasks: number };

/**
 * The people a plan's tasks name, with how many tasks each, most first; with
 * `only`, just the tasks it keeps (a re-run's new tasks: earlier ones keep
 * who's on them).
 */
export function planPeople(plan: ImportPlan, only?: (t: PlanTask) => boolean): FilePerson[] {
  const out = new Map<string, FilePerson>();
  for (const t of planTasks(plan)) {
    if (!t.assignee || (only && !only(t))) continue;
    const key = personKey(t.assignee);
    const seen = out.get(key);
    if (seen) seen.tasks += 1;
    else out.set(key, { key, label: personLabel(t.assignee), person: t.assignee, tasks: 1 });
  }
  return [...out.values()].sort((a, b) => b.tasks - a.tasks || a.label.localeCompare(b.label));
}

/**
 * Who each person in the file is here, as far as the app already shows the
 * person importing: themselves by their own email or name, a member by their
 * name when exactly one member who can take tasks has it. Members' emails
 * aren't readable in the app, so an email matches only your own, and nothing
 * is asked of the server; everyone else is picked by hand (default
 * Unassigned).
 */
export function suggestAssignees(
  people: ReadonlyArray<{ key: string; person: PlanPerson }>,
  members: ReadonlyArray<{ userId: string; fullName: string; canTakeTasks: boolean }>,
  me: { userId: string; email: string | null },
): Map<string, string | null> {
  const byName = new Map<string, string[]>();
  for (const m of members) {
    const k = m.fullName.trim().toLowerCase();
    if (!m.canTakeTasks || !k) continue;
    byName.set(k, [...(byName.get(k) ?? []), m.userId]);
  }
  const mine = me.email?.trim().toLowerCase() || null;
  const out = new Map<string, string | null>();
  for (const { key, person } of people) {
    if (mine && person.email === mine) {
      out.set(key, me.userId);
      continue;
    }
    const named = person.name ? byName.get(person.name.trim().toLowerCase()) : undefined;
    out.set(key, named?.length === 1 ? named[0]! : null);
  }
  return out;
}

/**
 * How a task's "imported from" reads (the panel's ⋯): the service and the
 * source's own id, which is copied as is and found by search. Todoist's CSV
 * has no ids, so its keys are ours and aren't shown.
 */
export function importedFromLine(
  from: { source: string; key: string } | null | undefined,
): { label: string; key: string | null } | null {
  if (!from?.source) return null;
  const known = IMPORT_SOURCES.find((s) => s.id === from.source.toLowerCase());
  const service = known?.label ?? from.source.charAt(0).toUpperCase() + from.source.slice(1);
  const ours = from.key.startsWith("todoist-");
  return { label: `Imported from ${service}`, key: ours || !from.key ? null : from.key };
}
