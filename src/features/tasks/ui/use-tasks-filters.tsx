// The Tasks page's Filter and search (tasks-v2 §7, TV-U2): the dimension
// registry with this workspace's members and tags, the scope's tasks after
// filters and search, and the toolbar pieces (search field, Filter button,
// active-filter row). The conditions themselves are stored with the scope's
// Display (use-tasks-display.tsx), so both are remembered per scope.

import {
  Ban,
  CalendarCheck,
  CalendarDays,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  Flag,
  Hourglass,
  ListChecks,
  ListTree,
  Paperclip,
  Repeat,
  Tag as TagIcon,
  User,
  UserPen,
  Users,
  Zap,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeLabelColor } from "../../../components/tag-colors";
import { TeamMark } from "../../../components/ui/avatar";
import { FilterBar, FilterButton } from "../../../components/ui/filter-bar";
import type {
  FilterCondition,
  FilterDimension,
  FilterOption,
} from "../../../components/ui/filter-model";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Assignee } from "../assignees";
import {
  addFilterValue,
  type CaptureSeed,
  captureSeed,
  filterTasks,
  NONE_VALUE,
  type TaskFilterContext,
  type TaskFilterDimension,
  taskFilterShape,
  WAITING_ANY,
} from "../filters";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Tag, Task, Team } from "../model";
import { takeSearchTokens, taskMatchesQuery } from "../search";
import { STATUS_KEY_LABELS } from "../statuses";
import { nowOn, useToday } from "../use-today";
import { AssigneeAvatar } from "./assignee-avatar";
import { StatusIcon } from "./status-icon";
import { TaskSearchField } from "./task-search-field";

const DIMENSION_ICONS: Record<TaskFilterDimension, FilterDimension["icon"]> = {
  assignee: User,
  team: Users,
  creator: UserPen,
  // The tag icon, as on the rows' count (MOD-97): "#" is only how you type one.
  tag: TagIcon,
  status: CircleDot,
  completed: CalendarCheck,
  priority: Flag,
  energy: Zap,
  due: CalendarDays,
  scheduled: Clock,
  queued: ListChecks,
  blocked: CircleDashed,
  waiting: Hourglass,
  recurring: Repeat,
  subtasks: ListTree,
  attachments: Paperclip,
};

const YES_NO: FilterOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const LEVELS = (none: string): FilterOption[] => [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: NONE_VALUE, label: none },
];

const OPTIONS: Partial<Record<TaskFilterDimension, FilterOption[]>> = {
  // The labels every surface uses ("To do", "Won't do", calls 21/53a). Won't
  // do tasks are out of every scope until this asks for them (TV-U2, AC1.4).
  // TV-D9: Backlog joins, and each value leads with its category's icon (the
  // values stay the stored legacy ones, so saved filters keep working).
  status: [
    {
      value: "backlog",
      label: STATUS_KEY_LABELS.backlog,
      leading: <StatusIcon category="backlog" />,
      keywords: ["someday", "not planned"],
    },
    { value: "todo", label: STATUS_KEY_LABELS.todo, leading: <StatusIcon category="todo" /> },
    {
      value: "in_progress",
      label: STATUS_KEY_LABELS.in_progress,
      leading: <StatusIcon category="in_progress" />,
    },
    { value: "done", label: STATUS_KEY_LABELS.done, leading: <StatusIcon category="done" /> },
    {
      value: "archived",
      label: STATUS_KEY_LABELS.archived,
      leading: <StatusIcon category="wont_do" />,
      keywords: ["won't do", "wont do", "archived"],
    },
  ],
  priority: LEVELS("No priority"),
  energy: LEVELS("No energy"),
  due: [
    { value: "today", label: "Today" },
    { value: "week", label: "This week" },
    { value: "earlier", label: "Earlier", keywords: ["overdue", "past"] },
    { value: NONE_VALUE, label: "No due date" },
  ],
  scheduled: [
    { value: "today", label: "Today" },
    { value: "week", label: "This week" },
    { value: "drifted", label: "Drifted", keywords: ["passed"] },
    { value: NONE_VALUE, label: "Not scheduled" },
  ],
  // When a task was finished (TV-U8; the week follows Time & region).
  completed: [
    { value: "today", label: "Today" },
    { value: "week", label: "This week" },
    { value: "last_week", label: "Last week" },
    { value: "month", label: "This month" },
    { value: NONE_VALUE, label: "Not completed" },
  ],
  // Who or what a task waits on (TV-U8): any entry, or one kind.
  waiting: [
    { value: WAITING_ANY, label: "Anything", keywords: ["waiting"] },
    { value: "person", label: "A teammate", keywords: ["person", "people"] },
    { value: "email", label: "An email reply", keywords: ["client", "reply"] },
    { value: "agent", label: "An agent" },
    { value: "text", label: "Something else", keywords: ["client"] },
    { value: NONE_VALUE, label: "Not waiting" },
  ],
  queued: YES_NO,
  blocked: YES_NO,
  recurring: YES_NO,
  subtasks: YES_NO,
  attachments: YES_NO,
};

/** A value a condition holds that the options don't list any more (a deleted
 *  tag, a former member) still gets a readable chip. */
function withUnknown(
  options: FilterOption[],
  conditions: readonly FilterCondition[],
  dimension: string,
  label: string,
): FilterOption[] {
  const known = new Set(options.map((o) => o.value));
  const extra = conditions
    .filter((c) => c.dimension === dimension)
    .flatMap((c) => c.values)
    .filter((v) => !known.has(v));
  return extra.length === 0
    ? options
    : [...options, ...[...new Set(extra)].map((value) => ({ value, label }))];
}

function personOptions(assignees: readonly Assignee[]): FilterOption[] {
  return assignees.map((a) => ({
    value: a.userId,
    label: a.name,
    leading: <AssigneeAvatar assignee={a} size="icon" />,
    keywords: a.isMe ? ["me", "mine"] : undefined,
  }));
}

/** The dimension registry: every §7 dimension with this workspace's options
 *  (Team only once the workspace has teams, or a saved filter names one). */
export function taskFilterDimensions(input: {
  assignees: readonly Assignee[];
  tags: readonly Tag[];
  countByTag: ReadonlyMap<string, number>;
  conditions: readonly FilterCondition[];
  teams?: readonly Team[];
}): FilterDimension[] {
  const { assignees, tags, countByTag, conditions, teams = [] } = input;
  const teamOptions: FilterOption[] = [...teams]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({
      value: team.id,
      label: team.name,
      leading: <TeamMark name={team.name} id={team.id} letters={team.mark} color={team.color} />,
    }));
  const tagOptions: FilterOption[] = [...tags]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tag) => ({
      value: tag.id,
      label: tag.name,
      count: countByTag.get(tag.id) ?? 0,
      leading: (
        <span
          aria-hidden
          data-label={normalizeLabelColor(tag.color)}
          className="tag-dot size-1.5 shrink-0 rounded-full"
        />
      ),
    }));
  const optionsFor = (id: TaskFilterDimension): FilterOption[] => {
    switch (id) {
      case "assignee":
        return withUnknown(
          [...personOptions(assignees), { value: NONE_VALUE, label: "Unassigned", icon: User }],
          conditions,
          id,
          "Former member",
        );
      case "team":
        return withUnknown(
          [...teamOptions, { value: NONE_VALUE, label: "No team", icon: Users }],
          conditions,
          id,
          "Former team",
        );
      case "creator":
        return withUnknown(personOptions(assignees), conditions, id, "Former member");
      case "tag":
        return withUnknown(
          [...tagOptions, { value: NONE_VALUE, label: "No tag" }],
          conditions,
          id,
          "Deleted tag",
        );
      default:
        return OPTIONS[id] ?? [];
    }
  };
  const usesTeam = teams.length > 0 || conditions.some((c) => c.dimension === "team");
  return (Object.keys(DIMENSION_ICONS) as TaskFilterDimension[])
    .filter((id) => id !== "team" || usesTeam)
    .map((id) => ({
      ...taskFilterShape(id),
      icon: DIMENSION_ICONS[id],
      options: optionsFor(id),
    }));
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * `/` opens search and `f` opens Filter, from anywhere on the page except a
 * text field, a dialog or an open menu. Bubble phase, after the list's own
 * keys; a modified key (⌘/ is notifications) or Shift (`?` is the shortcuts
 * sheet) is never ours.
 */
function useToolbarKeys(enabled: boolean, onSearch: () => void, onFilter: () => void) {
  const handlers = useRef({ onSearch, onFilter });
  useEffect(() => {
    handlers.current = { onSearch, onFilter };
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-slot="popover-content"]',
        )
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        handlers.current.onSearch();
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        handlers.current.onFilter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export type TasksFilterControls = {
  /** The scope's tasks after filters and search. */
  tasks: Task[];
  search: ReactNode;
  filter: ReactNode;
  /** The active-filter row, or undefined while no filter is on. */
  activeFilters: ReactNode | undefined;
  /** A filter or a search is narrowing the scope ("No tasks match" when empty). */
  active: boolean;
  /** A search is on (counted with the filters in "hidden by 2 filters"). */
  searching: boolean;
  /** Clears every filter and the search. */
  clear: () => void;
  /** What New pre-fills (U2-5). */
  seed: CaptureSeed;
};

/** A pause in typing before the server is asked (the copy answers at once). */
const SERVER_SEARCH_DELAY_MS = 250;

/**
 * `scopeTasks` is the scope before filtering (archived tasks only when a
 * Status filter asks for them). `enabled` turns the `/` and `f` keys on
 * (off while the page shows something else, like Execute). `keepTaskId` (a
 * deep-linked task while it's selected) stays listed, with its parent, past
 * the filters and search it arrived under: a link lands on its task without
 * clearing anyone's saved filters (TV-U2), as Display keeps it past
 * Completed (TV-U1). Changing the filters or the search ends that.
 */
export function useTasksFilters({
  workspaceId,
  scope,
  scopeTasks,
  conditions,
  onConditionsChange,
  api,
  assignees,
  enabled,
  keepTaskId = null,
  searchExtra,
}: {
  workspaceId: string;
  scope: string;
  scopeTasks: Task[];
  conditions: FilterCondition[];
  onConditionsChange: (next: FilterCondition[]) => void;
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  assignees: readonly Assignee[];
  enabled: boolean;
  keepTaskId?: string | null;
  /** Tasks only a search reaches, after the scope's own (archived projects'
   *  tasks in All, TV-U6: search still finds them, labelled). */
  searchExtra?: Task[];
}): TasksFilterControls {
  // Search is a live narrowing, not a preference: a new scope starts empty.
  const scopeKey = `${workspaceId}:${scope}`;
  const [search, setSearch] = useState({ scopeKey, query: "" });
  const query = search.scopeKey === scopeKey ? search.query : "";
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterWrapRef = useRef<HTMLSpanElement>(null);

  const dimensions = useMemo(
    () =>
      taskFilterDimensions({
        assignees,
        tags: api.tags,
        countByTag: api.openTaskCountByTag,
        conditions,
        teams: api.teams,
      }),
    [assignees, api.tags, api.openTaskCountByTag, conditions, api.teams],
  );

  // "Has attachments" reads the store's live 📎 counts (AT-3): files on tasks
  // you can see, finished and not deleted.
  const fileCounts = api.attachmentCounts;
  const attachmentCount = useCallback(
    (taskId: string) => fileCounts?.get(taskId) ?? 0,
    [fileCounts],
  );

  // Each task's Waiting on… kinds (the Waiting on filter).
  const waitingKinds = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const w of api.waiting ?? []) {
      const list = out.get(w.taskId);
      if (list) list.push(w.kind);
      else out.set(w.taskId, [w.kind]);
    }
    return out;
  }, [api.waiting]);

  // Today's date keys the context, so "Today" and "This week" roll over at
  // midnight.
  const today = useToday();
  const ctx = useMemo<TaskFilterContext>(
    () => ({
      now: new Date(),
      tagIdsOf: (id) => (api.tagsByTask.get(id) ?? []).map((t) => t.id),
      isQueued: (id) => api.queuedTaskIds.has(id),
      isBlocked: (id) => api.blockedTaskIds.has(id),
      hasSubtasks: (id) => (api.subtasksByParent.get(id)?.length ?? 0) > 0,
      attachmentCount,
      waitingKindsOf: (id) => waitingKinds.get(id) ?? [],
    }),
    [
      today,
      waitingKinds,
      api.tagsByTask,
      api.queuedTaskIds,
      api.blockedTaskIds,
      api.subtasksByParent,
      attachmentCount,
    ],
  );

  // The linked task is kept past the filters and search it arrived under;
  // once you change either, they decide again. Read at render, like the
  // page's kept Won't do task.
  const arrivedUnder = useRef<{
    id: string;
    conditions: readonly FilterCondition[];
    query: string;
  } | null>(null);
  if (keepTaskId !== (arrivedUnder.current?.id ?? null)) {
    arrivedUnder.current = keepTaskId ? { id: keepTaskId, conditions, query } : null;
  }
  const keeping =
    arrivedUnder.current &&
    arrivedUnder.current.conditions === conditions &&
    arrivedUnder.current.query === query
      ? arrivedUnder.current.id
      : null;

  // The server's search (TV-D11b), while the copy can't answer alone (closed
  // tasks still loading, a read cut at its ceiling): the store reads the
  // matches it lacks, and they pass here by id. The copy's own matches show
  // at once; these join a moment later.
  const searchServer = api.searchTasks;
  const [serverHits, setServerHits] = useState<{ query: string; ids: ReadonlySet<string> } | null>(
    null,
  );
  useEffect(() => {
    const q = query.trim();
    if (!q || !searchServer) return;
    let live = true;
    const timer = setTimeout(() => {
      void searchServer(q).then((ids) => {
        if (live && ids) setServerHits({ query: q, ids: new Set(ids) });
      });
    }, SERVER_SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, searchServer]);
  const serverIds = serverHits && serverHits.query === query.trim() ? serverHits.ids : null;

  const tasks = useMemo(() => {
    const searching = query.trim() !== "";
    const filtered = filterTasks(
      searching && searchExtra?.length ? [...scopeTasks, ...searchExtra] : scopeTasks,
      conditions,
      ctx,
    );
    const passing = searching
      ? filtered.filter((t) => taskMatchesQuery(t, query) || !!serverIds?.has(t.id))
      : filtered;
    if (!keeping) return passing;
    const kept = new Set([keeping]);
    const parentId = scopeTasks.find((t) => t.id === keeping)?.parentId;
    if (parentId) kept.add(parentId);
    if ([...kept].every((id) => passing.some((t) => t.id === id))) return passing;
    const pass = new Set(passing.map((t) => t.id));
    return scopeTasks.filter((t) => pass.has(t.id) || kept.has(t.id));
  }, [scopeTasks, searchExtra, conditions, ctx, query, keeping, serverIds]);

  const tokenContext = useMemo(
    () => ({
      tags: api.tags,
      people: assignees.map((a) => ({ userId: a.userId, name: a.name, isMe: a.isMe })),
    }),
    [api.tags, assignees],
  );
  const setQuery = useCallback(
    (next: string, final = false) => {
      const taken = takeSearchTokens(next, tokenContext, final);
      if (taken.tokens.length > 0) {
        let updated = conditions;
        for (const token of taken.tokens) {
          updated = addFilterValue(updated, token.dimension, token.value);
        }
        onConditionsChange(updated);
      }
      setSearch({ scopeKey, query: taken.query });
    },
    [tokenContext, conditions, onConditionsChange, scopeKey],
  );

  const clear = useCallback(() => {
    onConditionsChange([]);
    setSearch({ scopeKey, query: "" });
  }, [onConditionsChange, scopeKey]);

  useToolbarKeys(
    enabled,
    () => {
      setSearchOpen(true);
      inputRef.current?.focus();
    },
    () => setFilterOpen(true),
  );

  // The last chip going away unmounts the row, focus included: hand it to the
  // Filter button (DS-4 leaves this to the module).
  const prevCount = useRef(conditions.length);
  useEffect(() => {
    const had = prevCount.current;
    prevCount.current = conditions.length;
    if (had === 0 || conditions.length > 0) return;
    const active = document.activeElement;
    if (!active || active === document.body) {
      filterWrapRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
  }, [conditions.length]);

  const filteredCount = tasks.length;
  return {
    tasks,
    active: conditions.length > 0 || query.trim() !== "",
    searching: query.trim() !== "",
    clear,
    seed: useMemo(() => captureSeed(conditions), [conditions]),
    search: (
      <TaskSearchField
        value={query}
        onValueChange={(next) => setQuery(next)}
        onCommit={() => setQuery(query, true)}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        inputRef={inputRef}
      />
    ),
    filter: (
      <span ref={filterWrapRef} className="contents">
        <FilterButton
          dimensions={dimensions}
          value={conditions}
          onValueChange={onConditionsChange}
          open={filterOpen}
          onOpenChange={setFilterOpen}
          shortcut="F"
        />
      </span>
    ),
    activeFilters:
      conditions.length > 0 ? (
        <FilterBar
          dimensions={dimensions}
          value={conditions}
          onValueChange={onConditionsChange}
          matchCount={filteredCount}
          totalCount={scopeTasks.length}
        />
      ) : undefined,
  };
}
