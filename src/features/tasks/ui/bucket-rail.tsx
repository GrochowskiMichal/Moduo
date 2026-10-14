// The Tasks sidebar (TV-U6, specs/tasks-v3.md §3; REPLAN 14–16, 20, 29–30,
// 29a–e, 98; prototype round-1c frame 1):
//
//   Inbox · Focus · Upcoming · My tasks      ← yours
//   ─────────────────────────────────── ⋯    ← the hairline; ⋯ = Customize
//   All · Pinned · Views · projects without an area · areas and their projects
//   New project
//
// No labels on the blocks (the split is taught in Tasks' welcome), no glyphs
// on views, one sentence-case header style for every group, headers only when
// a group has something, every group collapses (remembered per person).
// Archived projects and Recently deleted open from the hairline's ⋯, never as
// permanent rows. "Project" everywhere; "bucket" stays a code word until D7.

import { useDndMonitor } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarDays,
  Inbox,
  Layers,
  ListChecks,
  MoreHorizontal,
  Plus,
  UserRound,
} from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import type { LabelColor } from "../../../components/tag-colors";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import {
  focusNavRow,
  type MenuKit,
  NavRow,
  NavRowDot,
  type NavRowProps,
  NavSectionHeader,
  restoreNavFocus,
} from "../../../components/ui/nav-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { TasksSidebarHideable } from "../../../lib/preferences";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { ShareMenu } from "../../sharing/share-menu";
import { RAIL_SORT_PREFIX, type RailDropTarget } from "../dnd/rail-drop";
import type { Area, Bucket } from "../model";
import { BUCKET_COLOR_OPTIONS, bucketDotColor, sidebarGroups } from "../sidebar";
import { type TaskView, viewIdOf, viewSelection } from "../views";
import { type RailDropAccepts, RailDropRow } from "./dnd/rail-drop-row";

/** The sidebar's selections besides projects: the centre views its ⋯ opens. */
export const ARCHIVED_SELECTION = "archived";
export const TRASH_SELECTION = "trash";
/** Templates (TV-D15): opened from the hairline's ⋯ until Settings → Tasks → Templates exists. */
export const TEMPLATES_SELECTION = "templates";
/** Upcoming (REPLAN 29, TV-U15's screen). */
export const UPCOMING_SELECTION = "upcoming";
/** Won't do: the reachable list with Reopen (tasks-v3 §2), from the ⋯ (TV-U15). */
export const WONTDO_SELECTION = "wontdo";

/** The keys collapse is remembered by: Pinned, Views, and each area. */
export const PINNED_GROUP = "pinned";
export const VIEWS_GROUP = "views";
export const areaGroupKey = (areaId: string) => `area:${areaId}`;

// Project rows are sortable inside the page's one DndContext (DF-22). Their
// ids carry their own prefix, apart from TV-U4's `rail:*` task drop targets,
// and the page's collision sorts them only against each other.
type RailProjectDrag = { type: "rail-project"; projectId: string };
const railProjectDrag = (projectId: string): RailProjectDrag => ({
  type: "rail-project",
  projectId,
});

/** The project a sidebar drag (or the row it's over) is about, or null. */
export function asRailProject(data: unknown): string | null {
  return data && typeof data === "object" && (data as { type?: unknown }).type === "rail-project"
    ? (data as RailProjectDrag).projectId
    : null;
}

type Props = {
  /** "inbox" | "today" (Focus) | "upcoming" | "mine" | "all" | "archived" | "trash" | project id */
  selection: string;
  onSelect: (selection: string) => void;
  /** Live projects (the Inbox excluded), in position order. */
  buckets: Bucket[];
  areas: Area[];
  inbox: Bucket | null;
  openCountByBucket: Map<string, number>;
  driftCountByBucket: Map<string, number>;
  totalOpenCount: number;
  /** My open queued tasks (Focus). */
  queueCount: number;
  /** My open assigned tasks; null hides "My tasks" (fewer than two members). */
  myTasksCount: number | null;
  canEdit: boolean;

  /** Customize sidebar (REPLAN 29a): the rows this person hid. */
  hidden: ReadonlySet<TasksSidebarHideable>;
  onToggleHidden: (row: TasksSidebarHideable) => void;
  /** Pin (REPLAN 29b): this person's pinned projects and views (`view:<id>`)
   *  here, in pin order. */
  pinned: readonly string[];
  /** A project id, or a view's `view:<id>`. */
  onTogglePin: (id: string) => void;
  /**
   * Saved views (TV-U8): yours in your order, then the ones shared with you.
   * Absent: no Views group (a build ahead of its server, stories).
   */
  views?: readonly TaskView[];
  viewActions?: ViewActions;
  /** Collapsed groups (REPLAN 29e): Pinned, Views and each area. */
  collapsed: ReadonlySet<string>;
  onToggleCollapsed: (key: string) => void;

  onCreateBucket: (name: string, areaId: string | null) => void;
  onRenameBucket: (id: string, name: string) => void;
  /** Opens the delete confirm (REPLAN 78). */
  onRequestDelete: (bucket: Bucket) => void;
  /** Archive: asks first when the project has open work (REPLAN 78). */
  onRequestArchive: (bucket: Bucket) => void;
  onSetBucketColor: (id: string, color: LabelColor) => void;
  /** A project dragged onto another one: it takes that place and area. */
  onMoveBucket: (activeId: string, overId: string) => void;
  onMoveBucketToArea: (id: string, areaId: string | null) => void;
  /** A project's hover "+": a new task in it. */
  onCaptureInto?: (bucketId: string) => void;
  /** Open batch-triage for a project's drifted tasks. */
  onTriageBucket: (bucketId: string) => void;
  /** A project's ⋯ → Statuses… (TV-D9). Absent: no such item. */
  onEditStatuses?: (bucketId: string) => void;
  /** The Inbox's ⋯ → Default statuses… (owners and admins). */
  onEditDefaultStatuses?: () => void;

  /** Areas (TV-D10's ops): make one (answers with its id), rename, colour,
   *  move one place, delete (its projects become area-less). */
  onCreateArea: (name: string) => Promise<string | null>;
  onRenameArea: (areaId: string, name: string) => void;
  onSetAreaColor: (areaId: string, color: LabelColor) => void;
  onMoveArea: (areaId: string, direction: "up" | "down") => void;
  onDeleteArea: (areaId: string) => void;

  /** Archived projects and Recently deleted: from the ⋯, never rows (98). */
  archivedCount: number;
  trashCount: number;
  /** Won't do tasks (TV-U15): from the ⋯ too. */
  wontDoCount?: number;
  /**
   * Templates (TV-D15): a project's ⋯ → Duplicate… and Save as template…, the
   * hairline's ⋯ → New project from template… and Templates. Absent: none of
   * them (a build ahead of its server, stories).
   */
  templates?: {
    onDuplicate: (bucket: Bucket) => void;
    onSaveAsTemplate: (bucket: Bucket) => void;
    onNewFromTemplate: () => void;
  };
  /** The hairline's ⋯ → "What's in Tasks" reopens Tasks' welcome (TV-U17). */
  onOpenWelcome?: () => void;
  /** The hairline's ⋯ → "Import tasks…" (TV-U18). */
  onImport?: () => void;

  /** The sidebar's <nav>, for the page to hand focus back to it (`focusNavRow`). */
  navRef?: RefObject<HTMLElement | null>;
  /**
   * Makes Focus, My tasks, Inbox and the projects task drop targets (TV-U4).
   * Only under the page's DndContext; absent = plain rows (stories, tests),
   * and the projects aren't sortable either.
   */
  dropAccepts?: RailDropAccepts;
};

/** A sidebar row: a drop target when the sidebar takes drops, else a plain NavRow. */
function RailRow({
  drop,
  ...props
}: NavRowProps & { drop?: { target: RailDropTarget; accepts?: RailDropAccepts } }) {
  return drop?.accepts ? (
    <RailDropRow target={drop.target} accepts={drop.accepts} {...props} />
  ) : (
    <NavRow {...props} />
  );
}

/** Collapsed group keys from storage; anything unreadable is "none collapsed". */
export function parseCollapsedSections(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((v): v is string => typeof v === "string" && v.trim() !== ""));
  } catch {
    return new Set();
  }
}

type Adding = { kind: "project"; areaId: string | null } | { kind: "area" } | null;

/** What a view's ⋯ can do (TV-U8). */
export type ViewActions = {
  /** Whose views are yours (only the maker changes a view). */
  currentUserId: string | null;
  onRename: (viewId: string, name: string) => void;
  onShare: (viewId: string, shared: boolean) => void;
  onDelete: (viewId: string) => void;
  onMove: (viewId: string, direction: "up" | "down") => void;
  onCopyLink: (viewId: string) => void;
  /** Sharing a view needs edit access. */
  canShare: boolean;
  /** The workspace's owner or an admin: may unshare or delete a shared view. */
  canModerate: boolean;
};

export function BucketRail({
  selection,
  onSelect,
  buckets,
  areas,
  inbox,
  openCountByBucket,
  driftCountByBucket,
  totalOpenCount,
  queueCount,
  myTasksCount,
  canEdit,
  hidden,
  onToggleHidden,
  pinned,
  onTogglePin,
  views = NO_VIEWS,
  viewActions,
  collapsed,
  onToggleCollapsed,
  onCreateBucket,
  onRenameBucket,
  onRequestDelete,
  onRequestArchive,
  onSetBucketColor,
  onMoveBucket,
  onMoveBucketToArea,
  onCaptureInto,
  onTriageBucket,
  onEditStatuses,
  onEditDefaultStatuses,
  onCreateArea,
  onRenameArea,
  onSetAreaColor,
  onMoveArea,
  onDeleteArea,
  archivedCount,
  trashCount,
  wontDoCount = 0,
  templates,
  onOpenWelcome,
  onImport,
  navRef,
  dropAccepts,
}: Props) {
  const ownNavRef = useRef<HTMLElement | null>(null);
  const nav = navRef ?? ownNavRef;
  const [adding, setAdding] = useState<Adding>(null);
  const [renamingArea, setRenamingArea] = useState<string | null>(null);
  // A popover a row's menu opened has no trigger to hand focus back to, so it
  // lands on the sidebar: the row itself if it survived, else the current row.
  const returnFocus = (bucketId: string | null) => (event: Event) =>
    restoreNavFocus(event, nav.current, bucketId);
  // An inline input closed by Enter/Esc unmounts with focus in it; the row it
  // belongs to renders on the next commit.
  const focusRowSoon = (navId: string | null) =>
    setTimeout(() => focusNavRow(nav.current, navId), 0);

  const groups = sidebarGroups(buckets, areas);
  const inboxDrift = inbox ? (driftCountByBucket.get(inbox.id) ?? 0) : 0;
  // Drag to reorder needs edit access and the page's DndContext.
  const sortable = canEdit && !!dropAccepts;
  const pinnedIds = new Set(pinned);
  // Pinned projects and views, in pin order (one that's gone drops out).
  const pinnedEntries = pinned.flatMap((id): PinnedEntry[] => {
    const viewId = viewIdOf(id);
    if (viewId) {
      const view = views.find((v) => v.id === viewId);
      return view ? [{ kind: "view", view }] : [];
    }
    const bucket = buckets.find((b) => b.id === id);
    return bucket ? [{ kind: "project", bucket }] : [];
  });
  const ownViews = views.filter((v) => v.ownerId === viewActions?.currentUserId);
  const viewRow = (view: TaskView, opts?: { pinnedCopy?: boolean }) => {
    const selectionKey = viewSelection(view.id);
    const mine = view.ownerId === viewActions?.currentUserId;
    const index = ownViews.findIndex((v) => v.id === view.id);
    return (
      <ViewRow
        key={opts?.pinnedCopy ? `pin:${selectionKey}` : selectionKey}
        view={view}
        navId={opts?.pinnedCopy ? `pin:${selectionKey}` : selectionKey}
        current={selection === selectionKey}
        mine={mine}
        pinned={pinnedIds.has(selectionKey)}
        first={index <= 0}
        last={index === -1 || index === ownViews.length - 1}
        actions={viewActions}
        onSelect={() => onSelect(selectionKey)}
        onTogglePin={() => onTogglePin(selectionKey)}
      />
    );
  };
  const shows = (row: TasksSidebarHideable) => !hidden.has(row);

  const projectRow = (bucket: Bucket, opts?: { pinnedCopy?: boolean }) => {
    const row = (drag?: DragSlot) => (
      <ProjectRow
        bucket={bucket}
        navId={opts?.pinnedCopy ? `pin:${bucket.id}` : bucket.id}
        count={openCountByBucket.get(bucket.id) ?? 0}
        drift={driftCountByBucket.get(bucket.id) ?? 0}
        current={selection === bucket.id}
        canEdit={canEdit}
        areas={areas}
        pinned={pinnedIds.has(bucket.id)}
        onSelect={() => onSelect(bucket.id)}
        onRename={(name) => onRenameBucket(bucket.id, name)}
        onDelete={() => onRequestDelete(bucket)}
        onArchive={() => onRequestArchive(bucket)}
        onSetColor={(color) => onSetBucketColor(bucket.id, color)}
        onSetArea={(areaId) => onMoveBucketToArea(bucket.id, areaId)}
        onNewArea={async (name) => {
          const id = await onCreateArea(name);
          if (id) onMoveBucketToArea(bucket.id, id);
        }}
        onTogglePin={() => onTogglePin(bucket.id)}
        onCapture={canEdit && onCaptureInto ? () => onCaptureInto(bucket.id) : undefined}
        onTriage={() => onTriageBucket(bucket.id)}
        onEditStatuses={onEditStatuses ? () => onEditStatuses(bucket.id) : undefined}
        onDuplicate={templates ? () => templates.onDuplicate(bucket) : undefined}
        onSaveAsTemplate={templates ? () => templates.onSaveAsTemplate(bucket) : undefined}
        onShareCloseAutoFocus={returnFocus(bucket.id)}
        onInputExit={() => focusRowSoon(bucket.id)}
        dropAccepts={dropAccepts}
        drag={drag}
      />
    );
    return sortable && !opts?.pinnedCopy ? (
      <SortableProject key={bucket.id} projectId={bucket.id}>
        {row}
      </SortableProject>
    ) : (
      <div key={opts?.pinnedCopy ? `pin:${bucket.id}` : bucket.id}>{row()}</div>
    );
  };
  // One sortable list per area: a drop on another area's project moves the
  // dragged one into that area (projectDropPatch).
  const projectList = (list: Bucket[]) =>
    sortable ? (
      <SortableContext
        items={list.map((b) => `${RAIL_SORT_PREFIX}${b.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {list.map((b) => projectRow(b))}
      </SortableContext>
    ) : (
      list.map((b) => projectRow(b))
    );
  const addProjectInput = (areaId: string | null) =>
    adding?.kind === "project" && adding.areaId === areaId ? (
      <NameInput
        placeholder="Project name — Enter to add"
        keepOpen
        onCommit={(name) => onCreateBucket(name, areaId)}
        onClose={() => setAdding(null)}
        onKeyExit={() => focusRowSoon(null)}
      />
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="pane-scroll min-h-0 flex-1 overflow-auto">
        <nav ref={nav} className="flex flex-col gap-px" aria-label="Tasks">
          {/* ── Yours ───────────────────────────────────────────────────── */}
          {inbox ? (
            // A droppable that never accepts (railDropAction): a task dropped
            // here does nothing — a shared task never turns private by a drop
            // — and the drop doesn't fall through to the Board's nearest column.
            <RailRow
              drop={{
                target: { type: "rail", target: "bucket", bucketId: inbox.id },
                accepts: dropAccepts,
              }}
              navId={inbox.id}
              label="Inbox"
              icon={<Inbox aria-hidden />}
              count={openCountByBucket.get(inbox.id) ?? 0}
              countLabel={`${openCountByBucket.get(inbox.id) ?? 0} open`}
              current={selection === "inbox" || selection === inbox.id}
              onSelect={() => onSelect("inbox")}
              indicator={
                inboxDrift > 0 ? (
                  <DriftMark
                    label={`${inboxDrift} drifted · triage`}
                    onTriage={() => onTriageBucket(inbox.id)}
                  />
                ) : undefined
              }
              menu={
                (canEdit && inboxDrift > 0) || onEditDefaultStatuses
                  ? (m) => (
                      <>
                        {canEdit && inboxDrift > 0 ? (
                          <m.Item onSelect={m.afterClose(() => onTriageBucket(inbox.id))}>
                            Triage {inboxDrift} drifted…
                          </m.Item>
                        ) : null}
                        {onEditDefaultStatuses ? (
                          <m.Item onSelect={m.afterClose(onEditDefaultStatuses)}>
                            Default statuses…
                          </m.Item>
                        ) : null}
                      </>
                    )
                  : undefined
              }
            />
          ) : null}
          {shows("focus") ? (
            <RailRow
              drop={{ target: { type: "rail", target: "queue" }, accepts: dropAccepts }}
              navId="today"
              label="Focus"
              icon={<ListChecks aria-hidden />}
              count={queueCount}
              countLabel={`${queueCount} lined up`}
              current={selection === "today"}
              onSelect={() => onSelect("today")}
            />
          ) : null}
          {shows("upcoming") ? (
            <NavRow
              navId={UPCOMING_SELECTION}
              label="Upcoming"
              icon={<CalendarDays aria-hidden />}
              current={selection === UPCOMING_SELECTION}
              onSelect={() => onSelect(UPCOMING_SELECTION)}
            />
          ) : null}
          {myTasksCount !== null && shows("mine") ? (
            <RailRow
              drop={{ target: { type: "rail", target: "mine" }, accepts: dropAccepts }}
              navId="mine"
              label="My tasks"
              icon={<UserRound aria-hidden />}
              count={myTasksCount}
              countLabel={`${myTasksCount} open`}
              current={selection === "mine"}
              onSelect={() => onSelect("mine")}
            />
          ) : null}

          {/* ── The hairline: above it is yours, below it is shared ─────── */}
          <SidebarHairline
            canEdit={canEdit}
            hidden={hidden}
            showMine={myTasksCount !== null}
            onToggleHidden={onToggleHidden}
            onNewProject={() => setAdding({ kind: "project", areaId: null })}
            onNewArea={() => setAdding({ kind: "area" })}
            archivedCount={archivedCount}
            trashCount={trashCount}
            onOpenArchived={() => onSelect(ARCHIVED_SELECTION)}
            onOpenTrash={() => onSelect(TRASH_SELECTION)}
            wontDoCount={wontDoCount}
            onOpenWontDo={() => onSelect(WONTDO_SELECTION)}
            wontDoCurrent={selection === WONTDO_SELECTION}
            archivedCurrent={selection === ARCHIVED_SELECTION}
            trashCurrent={selection === TRASH_SELECTION}
            onNewFromTemplate={templates?.onNewFromTemplate}
            onOpenTemplates={templates ? () => onSelect(TEMPLATES_SELECTION) : undefined}
            templatesCurrent={selection === TEMPLATES_SELECTION}
            onOpenWelcome={onOpenWelcome}
            onImport={onImport}
          />

          {/* ── Shared ──────────────────────────────────────────────────── */}
          {shows("all") ? (
            <NavRow
              navId="all"
              label="All"
              icon={<Layers aria-hidden />}
              count={totalOpenCount}
              countLabel={`${totalOpenCount} open`}
              current={selection === "all"}
              onSelect={() => onSelect("all")}
            />
          ) : null}

          {/* Pinned exists only once you pin something yourself (29b). */}
          {pinnedEntries.length > 0 ? (
            <div className="mt-2 flex flex-col gap-px">
              <NavSectionHeader
                label="Pinned"
                collapsed={collapsed.has(PINNED_GROUP)}
                onToggle={() => onToggleCollapsed(PINNED_GROUP)}
              />
              {collapsed.has(PINNED_GROUP)
                ? null
                : pinnedEntries.map((entry) =>
                    entry.kind === "view"
                      ? viewRow(entry.view, { pinnedCopy: true })
                      : projectRow(entry.bucket, { pinnedCopy: true }),
                  )}
            </div>
          ) : null}

          {/* Views (TV-U8, 29c–29e): no glyphs (names line up with the
              projects'), no header until there's one. */}
          {views.length > 0 ? (
            <div className="mt-2 flex flex-col gap-px">
              <NavSectionHeader
                label="Views"
                collapsed={collapsed.has(VIEWS_GROUP)}
                onToggle={() => onToggleCollapsed(VIEWS_GROUP)}
              />
              {collapsed.has(VIEWS_GROUP) ? null : views.map((v) => viewRow(v))}
            </div>
          ) : null}

          {sortable ? <ProjectDndMonitor onMove={onMoveBucket} /> : null}

          {/* Projects without an area come first, under no header (14). */}
          {groups.loose.length > 0 ? (
            <div className="mt-2 flex flex-col gap-px">{projectList(groups.loose)}</div>
          ) : null}

          {groups.areas.map(({ area, projects }, index) => {
            const key = areaGroupKey(area.id);
            const isCollapsed = collapsed.has(key);
            const open = projects.reduce((n, b) => n + (openCountByBucket.get(b.id) ?? 0), 0);
            const drift = projects.reduce((n, b) => n + (driftCountByBucket.get(b.id) ?? 0), 0);
            return (
              <div key={area.id} className="mt-2 flex flex-col gap-px">
                {renamingArea === area.id ? (
                  <NameInput
                    initial={area.name}
                    placeholder="Area name — Enter"
                    onCommit={(name) => onRenameArea(area.id, name)}
                    onClose={() => setRenamingArea(null)}
                    onKeyExit={() => focusRowSoon(null)}
                  />
                ) : (
                  <NavSectionHeader
                    label={area.name}
                    count={open}
                    countLabel={`${open} open`}
                    collapsed={isCollapsed}
                    onToggle={() => onToggleCollapsed(key)}
                    onAdd={
                      canEdit
                        ? () => {
                            if (isCollapsed) onToggleCollapsed(key);
                            setAdding({ kind: "project", areaId: area.id });
                          }
                        : undefined
                    }
                    addLabel={`New project in ${area.name}`}
                    menuLabel={`${area.name} options`}
                    indicator={
                      isCollapsed && drift > 0 ? (
                        <DriftMark label={`${drift} drifted in ${area.name} · expand to triage`} />
                      ) : undefined
                    }
                    menu={
                      canEdit
                        ? (m) => (
                            <AreaMenu
                              m={m}
                              area={area}
                              first={index === 0}
                              last={index === groups.areas.length - 1}
                              onRename={() => setRenamingArea(area.id)}
                              onSetColor={(c) => onSetAreaColor(area.id, c)}
                              onMove={(dir) => onMoveArea(area.id, dir)}
                              onNewProject={() => {
                                if (isCollapsed) onToggleCollapsed(key);
                                setAdding({ kind: "project", areaId: area.id });
                              }}
                              onDelete={() => onDeleteArea(area.id)}
                            />
                          )
                        : undefined
                    }
                  />
                )}
                {isCollapsed ? null : (
                  <>
                    {projectList(projects)}
                    {addProjectInput(area.id)}
                  </>
                )}
              </div>
            );
          })}

          {adding?.kind === "area" ? (
            <div className="mt-2">
              <NameInput
                placeholder="Area name — Enter"
                onCommit={(name) => void onCreateArea(name)}
                onClose={() => setAdding(null)}
                onKeyExit={() => focusRowSoon(null)}
              />
            </div>
          ) : null}
          {addProjectInput(null)}
          {canEdit && adding?.kind !== "project" ? (
            <NewProjectRow onClick={() => setAdding({ kind: "project", areaId: null })} />
          ) : null}
        </nav>
      </div>
    </div>
  );
}

// ── the hairline and its ⋯ (REPLAN 20 A, 29a, 98) ────────────────────────────

const HIDEABLE_LABELS: Record<TasksSidebarHideable, string> = {
  focus: "Focus",
  upcoming: "Upcoming",
  mine: "My tasks",
  all: "All",
};

function SidebarHairline({
  canEdit,
  hidden,
  showMine,
  onToggleHidden,
  onNewProject,
  onNewArea,
  archivedCount,
  trashCount,
  onOpenArchived,
  onOpenTrash,
  archivedCurrent,
  trashCurrent,
  wontDoCount,
  onOpenWontDo,
  wontDoCurrent,
  onNewFromTemplate,
  onOpenTemplates,
  templatesCurrent,
  onOpenWelcome,
  onImport,
}: {
  canEdit: boolean;
  hidden: ReadonlySet<TasksSidebarHideable>;
  showMine: boolean;
  onToggleHidden: (row: TasksSidebarHideable) => void;
  onNewProject: () => void;
  onNewArea: () => void;
  archivedCount: number;
  trashCount: number;
  onOpenArchived: () => void;
  onOpenTrash: () => void;
  archivedCurrent: boolean;
  trashCurrent: boolean;
  wontDoCount: number;
  onOpenWontDo: () => void;
  wontDoCurrent: boolean;
  onNewFromTemplate?: () => void;
  onOpenTemplates?: () => void;
  templatesCurrent: boolean;
  onOpenWelcome?: () => void;
  /** "Import tasks…" (TV-U18), when you can import here. */
  onImport?: () => void;
}) {
  const rows: TasksSidebarHideable[] = showMine
    ? ["focus", "upcoming", "mine", "all"]
    : ["focus", "upcoming", "all"];
  // An item that opens an inline input runs once the menu has closed, so the
  // closing menu doesn't take focus back from the input (and close it).
  const pending = useRef<(() => void) | null>(null);
  const afterClose = (action: () => void) => () => {
    pending.current = action;
  };
  return (
    <div
      data-slot="sidebar-hairline"
      className="group/hair relative my-1 flex h-3 shrink-0 items-center px-2"
    >
      <span aria-hidden className="h-px flex-1 bg-hairline" />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Sidebar options"
                className="absolute right-1.5 flex size-5 items-center justify-center rounded-sm bg-card text-muted-foreground opacity-0 outline-none transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/hair:opacity-100 hover:bg-state-active hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:opacity-100"
              >
                <MoreHorizontal className="size-icon-sm" aria-hidden />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Sidebar options</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            const action = pending.current;
            if (!action) return;
            pending.current = null;
            event.preventDefault();
            action();
          }}
        >
          <DropdownMenuLabel>Customize sidebar</DropdownMenuLabel>
          {rows.map((row) => (
            <DropdownMenuCheckboxItem
              key={row}
              checked={!hidden.has(row)}
              // Keep the menu open while ticking several.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggleHidden(row)}
            >
              {HIDEABLE_LABELS[row]}
            </DropdownMenuCheckboxItem>
          ))}
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={afterClose(onNewProject)}>New project</DropdownMenuItem>
              {onNewFromTemplate ? (
                <DropdownMenuItem onSelect={afterClose(onNewFromTemplate)}>
                  New project from template…
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={afterClose(onNewArea)}>New area…</DropdownMenuItem>
              {onImport ? (
                // Opens a dialog: wait for the menu to close (gotchas/ui.md).
                <DropdownMenuItem onSelect={afterClose(onImport)}>Import tasks…</DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenArchived} data-current={archivedCurrent || undefined}>
            Archived projects
            {archivedCount > 0 ? (
              <DropdownMenuShortcut>{archivedCount}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenWontDo} data-current={wontDoCurrent || undefined}>
            Won’t do
            {wontDoCount > 0 ? <DropdownMenuShortcut>{wontDoCount}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenTrash} data-current={trashCurrent || undefined}>
            Recently deleted
            {trashCount > 0 ? <DropdownMenuShortcut>{trashCount}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
          {onOpenTemplates ? (
            <DropdownMenuItem
              onSelect={onOpenTemplates}
              data-current={templatesCurrent || undefined}
            >
              Templates
            </DropdownMenuItem>
          ) : null}
          {onOpenWelcome ? (
            <>
              <DropdownMenuSeparator />
              {/* Opens a dialog: wait for the menu to close (gotchas/ui.md). */}
              <DropdownMenuItem onSelect={afterClose(onOpenWelcome)}>
                What’s in Tasks
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** "+ New project" at the end of the sidebar (prototype round-1c frame 1). */
function NewProjectRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 flex h-(--row-h) min-w-0 items-center gap-2.5 rounded-md pr-1.5 pl-2 text-left font-display text-base text-muted-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="flex w-icon shrink-0 items-center justify-center">
        <Plus className="size-icon-sm" aria-hidden />
      </span>
      New project
    </button>
  );
}

// ── area header menu ──────────────────────────────────────────────────────────

function AreaMenu({
  m,
  area,
  first,
  last,
  onRename,
  onSetColor,
  onMove,
  onNewProject,
  onDelete,
}: {
  m: MenuKit;
  area: Area;
  first: boolean;
  last: boolean;
  onRename: () => void;
  onSetColor: (color: LabelColor) => void;
  onMove: (direction: "up" | "down") => void;
  onNewProject: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <m.Item onSelect={m.afterClose(onNewProject)}>New project</m.Item>
      <m.Item onSelect={m.afterClose(onRename)}>Rename</m.Item>
      <ColourMenu m={m} value={bucketDotColor(area)} onChange={onSetColor} />
      <m.Item disabled={first} onSelect={() => onMove("up")}>
        Move up
      </m.Item>
      <m.Item disabled={last} onSelect={() => onMove("down")}>
        Move down
      </m.Item>
      <m.Separator />
      <m.Item variant="destructive" onSelect={onDelete}>
        Delete area
      </m.Item>
    </>
  );
}

function ColourMenu({
  m,
  value,
  onChange,
}: {
  m: MenuKit;
  value: LabelColor;
  onChange: (color: LabelColor) => void;
}) {
  return (
    <m.Sub>
      <m.SubTrigger>Colour</m.SubTrigger>
      <m.SubContent>
        <m.RadioGroup value={value} onValueChange={(v) => onChange(v as LabelColor)}>
          {BUCKET_COLOR_OPTIONS.map((option) => (
            <m.RadioItem key={option.value} value={option.value}>
              <NavRowDot color={option.value} />
              {option.label}
            </m.RadioItem>
          ))}
        </m.RadioGroup>
      </m.SubContent>
    </m.Sub>
  );
}

// ── drift mark ────────────────────────────────────────────────────────────────

/**
 * Drift is ambient: a quiet dot before the count, never red (tasks-v2 T7). It
 * sits outside the count's slot, so it stays put while the count swaps for ⋯
 * and a click on it still opens triage.
 */
function DriftMark({ label, onTriage }: { label: string; onTriage?: () => void }) {
  const dot = <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onTriage ? (
          <button
            type="button"
            aria-label={label}
            onClick={onTriage}
            // hit-min pads the pointer target to 24 px; the dot stays put.
            className="hit-min flex size-4 items-center justify-center rounded-sm outline-none hover:bg-state-active focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {dot}
          </button>
        ) : (
          <span role="img" aria-label={label} className="flex size-4 items-center justify-center">
            {dot}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── project rows ──────────────────────────────────────────────────────────────

/** What a sortable wrapper hands its row. */
type DragSlot = { isDragging: boolean };

/**
 * A project row you can drag to reorder (TV-U6). The whole row is the
 * activator (a pointer move past the sensor's threshold starts the drag, so a
 * click still selects it) and the only keyboard activator, so Space/Enter on
 * its own buttons never lift it (dnd-kit's keyboard sensor checks the target).
 */
function SortableProject({
  projectId,
  children,
}: {
  projectId: string;
  children: (drag: DragSlot) => ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: `${RAIL_SORT_PREFIX}${projectId}`, data: railProjectDrag(projectId) });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        setActivatorNodeRef(el);
      }}
      // dnd-kit's own transform while sorting (no design property).
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10" : undefined}
      {...listeners}
    >
      {children({ isDragging })}
    </div>
  );
}

type PinnedEntry = { kind: "project"; bucket: Bucket } | { kind: "view"; view: TaskView };

const NO_VIEWS: readonly TaskView[] = [];

/**
 * A saved view in the sidebar (TV-U8). Yours: Rename · Pin · Share · Move ·
 * Copy link · Delete. Someone else's shared view: Pin · Copy link (and, for
 * the workspace's owner or an admin, Stop sharing). No glyph: an empty slot
 * keeps its name in line with the projects' (29c).
 */
function ViewRow({
  view,
  navId,
  current,
  mine,
  pinned,
  first,
  last,
  actions,
  onSelect,
  onTogglePin,
}: {
  view: TaskView;
  navId: string;
  current: boolean;
  mine: boolean;
  pinned: boolean;
  first: boolean;
  last: boolean;
  actions?: ViewActions;
  onSelect: () => void;
  onTogglePin: () => void;
}) {
  const moderate = !mine && view.shared && !!actions?.canModerate;
  // Changing what a shared view shows needs Tasks edit (the server says so too).
  const canRename = mine && !!actions && (actions.canShare || !view.shared);
  const menu = (m: MenuKit) => (
    <>
      {canRename ? <m.Item onSelect={m.rename}>Rename</m.Item> : null}
      <m.Item onSelect={onTogglePin}>{pinned ? "Unpin from sidebar" : "Pin to sidebar"}</m.Item>
      {mine && actions && (actions.canShare || view.shared) ? (
        <m.Item onSelect={() => actions.onShare(view.id, !view.shared)}>
          {view.shared ? "Stop sharing" : "Share with the workspace"}
        </m.Item>
      ) : null}
      {moderate && actions ? (
        <m.Item onSelect={() => actions.onShare(view.id, false)}>Stop sharing</m.Item>
      ) : null}
      {mine && actions ? (
        <>
          <m.Item disabled={first} onSelect={() => actions.onMove(view.id, "up")}>
            Move up
          </m.Item>
          <m.Item disabled={last} onSelect={() => actions.onMove(view.id, "down")}>
            Move down
          </m.Item>
        </>
      ) : null}
      {actions ? <m.Item onSelect={() => actions.onCopyLink(view.id)}>Copy link</m.Item> : null}
      {mine && actions ? (
        <>
          <m.Separator />
          <m.Item variant="destructive" onSelect={() => actions.onDelete(view.id)}>
            Delete view
          </m.Item>
        </>
      ) : null}
    </>
  );
  return (
    <NavRow
      navId={navId}
      label={view.name}
      icon={<span aria-hidden />}
      current={current}
      onSelect={onSelect}
      onRename={canRename && actions ? (name) => actions.onRename(view.id, name) : undefined}
      menu={menu}
      menuLabel={`${view.name} options`}
    />
  );
}

/** Commits a project drop: inside the page's DndContext, it reacts only to sidebar projects. */
function ProjectDndMonitor({ onMove }: { onMove: (activeId: string, overId: string) => void }) {
  useDndMonitor({
    onDragEnd: (event) => {
      const active = asRailProject(event.active.data.current);
      const over = asRailProject(event.over?.data.current);
      if (active && over && active !== over) onMove(active, over);
    },
  });
  return null;
}

function ProjectRow({
  bucket,
  navId,
  count,
  drift,
  current,
  canEdit,
  areas,
  pinned,
  onSelect,
  onRename,
  onDelete,
  onArchive,
  onSetColor,
  onSetArea,
  onNewArea,
  onTogglePin,
  onCapture,
  onTriage,
  onEditStatuses,
  onDuplicate,
  onSaveAsTemplate,
  onShareCloseAutoFocus,
  onInputExit,
  dropAccepts,
  drag,
}: {
  bucket: Bucket;
  navId: string;
  count: number;
  drift: number;
  current: boolean;
  canEdit: boolean;
  areas: Area[];
  pinned: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onArchive: () => void;
  onSetColor: (color: LabelColor) => void;
  onSetArea: (areaId: string | null) => void;
  onNewArea: (name: string) => void;
  onTogglePin: () => void;
  /** The hover "+": a new task in this project. */
  onCapture?: () => void;
  onTriage: () => void;
  onEditStatuses?: () => void;
  /** Duplicate… and Save as template… (TV-D15). */
  onDuplicate?: () => void;
  onSaveAsTemplate?: () => void;
  onShareCloseAutoFocus: (event: Event) => void;
  /** The New area input closed by Enter/Esc: focus goes back to the row. */
  onInputExit: () => void;
  dropAccepts?: RailDropAccepts;
  drag?: DragSlot;
}) {
  const [sharing, setSharing] = useState(false);
  const [addingArea, setAddingArea] = useState(false);

  if (addingArea) {
    return (
      <NameInput
        placeholder="Area name — Enter"
        onCommit={(name) => onNewArea(name)}
        onClose={() => setAddingArea(false)}
        onKeyExit={onInputExit}
      />
    );
  }

  const pinItem = (m: MenuKit) => (
    <m.Item onSelect={onTogglePin}>{pinned ? "Unpin from sidebar" : "Pin to sidebar"}</m.Item>
  );
  // Rename · Colour · Area · Pin · Share · Statuses · Triage · Duplicate ·
  // Save as template · Archive · Delete
  const templateItems = (m: MenuKit) =>
    onDuplicate || onSaveAsTemplate ? (
      <>
        <m.Separator />
        {onDuplicate ? <m.Item onSelect={m.afterClose(onDuplicate)}>Duplicate…</m.Item> : null}
        {onSaveAsTemplate ? (
          <m.Item onSelect={m.afterClose(onSaveAsTemplate)}>Save as template…</m.Item>
        ) : null}
      </>
    ) : null;
  const menu = (m: MenuKit) =>
    canEdit ? (
      <>
        <m.Item onSelect={m.rename}>Rename</m.Item>
        <ColourMenu m={m} value={bucketDotColor(bucket)} onChange={onSetColor} />
        <m.Sub>
          <m.SubTrigger>Area</m.SubTrigger>
          <m.SubContent>
            <m.RadioGroup
              value={
                bucket.areaId && areas.some((a) => a.id === bucket.areaId) ? bucket.areaId : "none"
              }
              onValueChange={(v) => onSetArea(v === "none" ? null : v)}
            >
              <m.RadioItem value="none">No area</m.RadioItem>
              {areas.map((a) => (
                <m.RadioItem key={a.id} value={a.id}>
                  {a.name}
                </m.RadioItem>
              ))}
            </m.RadioGroup>
            <m.Separator />
            <m.Item onSelect={m.afterClose(() => setAddingArea(true))}>New area…</m.Item>
          </m.SubContent>
        </m.Sub>
        {pinItem(m)}
        <m.Item onSelect={m.afterClose(() => setSharing(true))}>Share</m.Item>
        {onEditStatuses ? <m.Item onSelect={m.afterClose(onEditStatuses)}>Statuses…</m.Item> : null}
        {drift > 0 ? (
          <m.Item onSelect={m.afterClose(onTriage)}>Triage {drift} drifted…</m.Item>
        ) : null}
        {templateItems(m)}
        <m.Separator />
        <m.Item onSelect={m.afterClose(onArchive)}>Archive…</m.Item>
        <m.Item variant="destructive" onSelect={m.afterClose(onDelete)}>
          Delete project…
        </m.Item>
      </>
    ) : (
      pinItem(m)
    );

  return (
    // Positioned so the Share popover can anchor to the row.
    <div className="relative">
      <RailRow
        drop={{
          target: { type: "rail", target: "bucket", bucketId: bucket.id },
          accepts: dropAccepts,
        }}
        navId={navId}
        label={bucket.name}
        icon={<NavRowDot color={bucketDotColor(bucket)} />}
        count={count}
        countLabel={`${count} open`}
        current={current}
        // On hold and Done read one step quieter (REPLAN 16); never hidden.
        className={
          !current && (bucket.status === "on_hold" || bucket.status === "done")
            ? "text-subtle-foreground"
            : undefined
        }
        onSelect={onSelect}
        indicator={
          drift > 0 ? (
            <DriftMark label={`${drift} drifted · triage`} onTriage={onTriage} />
          ) : undefined
        }
        onRename={canEdit ? onRename : undefined}
        menu={menu}
        onAdd={onCapture}
        addLabel={`New task in ${bucket.name}`}
        dragging={drag?.isDragging}
      />
      {sharing ? (
        <ProjectShare
          bucketId={bucket.id}
          onClose={() => setSharing(false)}
          onCloseAutoFocus={onShareCloseAutoFocus}
        />
      ) : null}
    </div>
  );
}

/** The Share popover, opened from the row menu and anchored to the row. */
function ProjectShare({
  bucketId,
  onClose,
  onCloseAutoFocus,
}: {
  bucketId: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { userId } = useAuth();
  const { members } = useWorkspace();
  return (
    <ShareMenu
      defaultOpen
      anchor="parent"
      onOpenChange={(open) => !open && onClose()}
      onCloseAutoFocus={onCloseAutoFocus}
      resourceType="bucket"
      resourceId={bucketId}
      selfUserId={userId}
      members={members
        .filter((m) => m.isActive && !m.removedAt)
        .map((m) => ({ userId: m.userId, name: m.displayName?.trim() || "Member" }))}
    />
  );
}

// ── inline name input (a new project, a new or renamed area) ─────────────────

function NameInput({
  initial = "",
  placeholder,
  keepOpen = false,
  onCommit,
  onClose,
  onKeyExit,
}: {
  initial?: string;
  placeholder: string;
  /** Enter adds and stays open for the next one (new projects). */
  keepOpen?: boolean;
  onCommit: (name: string) => void;
  onClose: () => void;
  /** Enter/Esc closed it: focus goes back to the sidebar (a blur already moved it). */
  onKeyExit: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = (stayOpen: boolean) => {
    const name = value.trim();
    if (name && name !== initial) onCommit(name);
    if (stayOpen) {
      setValue("");
      ref.current?.focus();
      return;
    }
    if (done.current) return;
    done.current = true;
    onClose();
  };

  return (
    <div className="px-1 py-0.5">
      <Input
        ref={ref}
        size="sm"
        aria-label={placeholder.split(" —")[0]}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(keepOpen);
            if (!keepOpen) onKeyExit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            done.current = true;
            onClose();
            onKeyExit();
          }
        }}
        onBlur={() => commit(false)}
        className="px-1.5"
      />
    </div>
  );
}
