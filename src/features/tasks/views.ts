// Saved views (TV-U8, specs/tasks-v3.md block 21; REPLAN 29b–29e, 29d): the
// pure rules. A view is a name over a base place (All, My tasks, Upcoming or
// one project), the Filter's conditions and the Display choices. It stores a
// filter, never results: each reader sees what their own access shows
// through it (the server hides a shared view of a project from anyone who
// can't see that project). Views live in one place, the sidebar's Views group
// (29d: no project tabs); a view saved inside a project keeps that project.
//
// In the sidebar a view is the selection `view:<id>`; Pinned holds it the
// same way (`preferences.tasksSidebar.pinned[ws]`, beside project ids).

import type { TaskViewScope } from "@contracts/vocabularies";
import type { FilterCondition } from "../../components/ui/filter-model";
import {
  displayOf,
  sanitizeTasksView,
  type TasksDisplay,
  type TasksViewPrefs,
  tasksViewDefaults,
} from "./display";
import { NONE_VALUE, WAITING_ANY } from "./filters";
import type { TasksRole } from "./onboarding";
import type { RowPreset } from "./row-layout";
import type { TaskView } from "./view-row";

export { type TaskView, taskViewFromRow } from "./view-row";

// ── the selection ───────────────────────────────────────────────────────────

const VIEW_PREFIX = "view:";

/** The sidebar selection (and the Pinned entry) for a view. */
export function viewSelection(viewId: string): string {
  return `${VIEW_PREFIX}${viewId}`;
}

/** The view a selection (or a Pinned entry) names, else null. */
export function viewIdOf(selection: string | null | undefined): string | null {
  return selection?.startsWith(VIEW_PREFIX) ? selection.slice(VIEW_PREFIX.length) || null : null;
}

/** The place a view looks at, as the sidebar names it: "all", "mine",
 *  "upcoming" or a project id. */
export function viewPlace(view: Pick<TaskView, "scope" | "projectId">): string {
  return view.scope === "project" ? (view.projectId ?? "all") : view.scope;
}

/** What a place saves as (Save as view…), or null where views aren't saved:
 *  the Inbox, Focus, Won't do, Archived, Recently deleted, Templates. */
export function viewScopeOf(
  place: string,
  projectIds: readonly string[],
): { scope: TaskViewScope; projectId: string | null } | null {
  if (place === "all" || place === "mine" || place === "upcoming") {
    return { scope: place, projectId: null };
  }
  return projectIds.includes(place) ? { scope: "project", projectId: place } : null;
}

// ── Filter and Display ──────────────────────────────────────────────────────

/** A view's Filter and Display as the page uses them: read through the same
 *  sanitiser as a place's own, against its place's defaults (a choice that
 *  place doesn't offer falls back). */
export function viewPrefsOf(
  view: Pick<TaskView, "scope" | "projectId" | "filters" | "display">,
  rows: RowPreset = "standard",
): TasksViewPrefs {
  const place = viewPlace(view);
  const display = view.display && typeof view.display === "object" ? view.display : {};
  return sanitizeTasksView(
    { ...(display as Record<string, unknown>), filters: view.filters },
    tasksViewDefaults(place, undefined, rows),
    place,
  );
}

/**
 * A new view's starting Filter and Display (MOD-142, the Views header's +):
 * a blank view over All, as a saved view with no choices reads, so nothing
 * from All's own Filter comes along.
 */
export function newViewPrefs(rows: RowPreset = "standard"): TasksViewPrefs {
  return viewPrefsOf({ scope: "all", projectId: null, filters: [], display: {} }, rows);
}

/** What a view stores for the page's Filter and Display. */
export function viewPayload(prefs: TasksViewPrefs): {
  filters: FilterCondition[];
  display: TasksDisplay;
} {
  return { filters: prefs.filters, display: displayOf(prefs) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Whether two Filter + Display states say the same thing ("Save changes" shows when not). */
export function samePrefs(a: TasksViewPrefs, b: TasksViewPrefs): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// ── the sidebar's order ─────────────────────────────────────────────────────

/** The Views group: yours in your order, then the ones shared with you by name. */
export function sidebarViews(views: readonly TaskView[], me: string | null): TaskView[] {
  const live = views.filter((v) => !v.deletedAt);
  const mine = live
    .filter((v) => v.ownerId === me)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const shared = live
    .filter((v) => v.ownerId !== me)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [...mine, ...shared];
}

/** A name not taken yet among these views: "Waiting", "Waiting 2", … */
export function freeViewName(name: string, views: readonly Pick<TaskView, "name">[]): string {
  const base = name.trim() || "Untitled view";
  const taken = new Set(views.map((v) => v.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const next = `${base} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return base;
}

// ── seeded views (TV-U17's role defaults; REPLAN §3, AC4.8) ─────────────────

/** A seeded view: its key (the server makes each once per person), name,
 *  place and what it shows. */
export type SeedView = {
  seed: string;
  name: string;
  scope: Exclude<TaskViewScope, "project">;
  filters: FilterCondition[];
  display: Partial<TasksDisplay>;
};

const SEEDS = {
  // Student
  today: {
    seed: "today",
    name: "Today",
    scope: "mine",
    filters: [{ dimension: "due", operator: "any_of", values: ["today", "earlier"] }],
    display: {},
  },
  // Developer
  this_week: {
    seed: "this_week",
    name: "This week",
    scope: "mine",
    filters: [{ dimension: "due", operator: "is", values: ["week"] }],
    display: {},
  },
  // PM
  waiting: {
    seed: "waiting",
    name: "Waiting",
    scope: "all",
    filters: [{ dimension: "waiting", operator: "is", values: [WAITING_ANY] }],
    display: {},
  },
  due_this_week: {
    seed: "due_this_week",
    name: "Due this week",
    scope: "all",
    filters: [{ dimension: "due", operator: "is", values: ["week"] }],
    display: { order: "due" },
  },
  // Founder / ops
  waiting_on_people: {
    seed: "waiting_on_people",
    name: "Waiting on people",
    scope: "all",
    filters: [{ dimension: "waiting", operator: "is", values: ["person"] }],
    display: {},
  },
  // Client work
  waiting_on_client: {
    seed: "waiting_on_client",
    name: "Waiting on client",
    scope: "all",
    filters: [{ dimension: "waiting", operator: "any_of", values: ["email", "text"] }],
    display: {},
  },
  // Creator
  pipeline: {
    seed: "pipeline",
    name: "Pipeline",
    scope: "all",
    filters: [],
    display: { layout: "board", boardGroup: "status" },
  },
  publish_dates: {
    seed: "publish_dates",
    name: "Publish dates",
    scope: "all",
    filters: [{ dimension: "due", operator: "is_not", values: [NONE_VALUE] }],
    display: { group: "date", order: "due" },
  },
  // Everyone
  done_last_week: {
    seed: "done_last_week",
    name: "Done last week",
    scope: "all",
    filters: [
      { dimension: "status", operator: "is", values: ["done"] },
      { dimension: "completed", operator: "is", values: ["last_week"] },
    ],
    display: { completed: "all" },
  },
} as const satisfies Record<string, SeedView>;

export type SeedViewKey = keyof typeof SEEDS;

/**
 * The views a role starts with (REPLAN §3's column), keys in sidebar order.
 * The table predates Upcoming and My tasks as sidebar rows, so the student's
 * "Upcoming" and the developer's "Mine" aren't seeded (the rows are there).
 */
export const ROLE_SEED_VIEWS: Record<TasksRole, readonly SeedViewKey[]> = {
  student: ["today"],
  developer: ["this_week"],
  pm: ["waiting", "due_this_week"],
  founder: ["waiting_on_people"],
  client_work: ["waiting_on_client"],
  creator: ["pipeline", "publish_dates"],
};

/** Every person's: "Done last week" (AC4.8). */
export const EVERYONE_SEED_VIEWS: readonly SeedViewKey[] = ["done_last_week"];

/** The views to seed for someone: their role's (none without one), then everyone's. */
export function seedViewsFor(role: TasksRole | null): SeedView[] {
  const keys = [...(role ? ROLE_SEED_VIEWS[role] : []), ...EVERYONE_SEED_VIEWS];
  return keys.map((k) => ({
    ...SEEDS[k],
    filters: SEEDS[k].filters.map((c) => ({ ...c, values: [...c.values] })),
    display: { ...SEEDS[k].display },
  }));
}

/**
 * Whether to seed someone's views in a workspace now: once per person and
 * workspace, after their preferences and the server have both answered this
 * session (TV-U17's rule for anything once per person), and once onboarding
 * has decided (the role question answered or skipped, or Tasks' welcome
 * stepped aside for someone who knows Tasks).
 */
export function shouldSeedViews(input: {
  prefsReady: boolean;
  reachedServer: boolean;
  onboardingDecided: boolean;
  seededAlready: boolean;
}): boolean {
  return input.prefsReady && input.reachedServer && input.onboardingDecided && !input.seededAlready;
}
