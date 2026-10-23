/**
 * The New Notes sidebar (specs/notes-refresh.md NR-2, AC2/AC4):
 * Favorites · Inbox · Pages, then a Published / Archive / Trash footer.
 *
 * - A note only changes section when someone moves it (stored Inbox, NR-1).
 * - One `role="tree"` with a roving tabindex: ↑↓ → ← ↵ ⌫ and ⌥⇧↑↓ act the way
 *   a file tree does (tree-keyboard.ts).
 * - Drag reorders, nests, files and un-files (use-sidebar-drag.ts).
 * - View-only hides create, drag, publish and trash.
 */

import { DragOverlay } from "@dnd-kit/core";
import { Archive, FileText, Globe, Import, type LucideIcon, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SidebarFooter } from "@/components/app/sidebar-footer";
import { DragOverlaySurface, DROP_TARGET } from "@/components/ui/drag-visuals";
import { NavSectionHeader } from "@/components/ui/nav-row";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { betweenPositions, endPosition } from "../../tasks/helpers";
import type { Note } from "../model";
import type { NoteSearchResult } from "../search";
import type { SidebarSections } from "../sections";
import { displayTitle } from "../title";
import type { NoteTreeNode } from "../tree";
import { type DropIntent, keyboardReorderIntent, type SidebarSection } from "./drop-intent";
import { footerCounts, FooterSubView, type FooterView } from "./sidebar-footer-views";
import { SidebarSearchInput, SidebarSearchResults, useNoteSearch } from "./sidebar-search";
import { rowKey, type TreeCtx, TreeNodes, TreeRow } from "./sidebar-tree";
import { treeKeyAction, type TreeRow as KeyRow } from "./tree-keyboard";
import { useSidebarDrag } from "./use-sidebar-drag";

export type NotesSidebarProps = {
  workspaceId: string;
  /** Every note the sidebar may show (the live draft included). */
  notes: Note[];
  sections: SidebarSections;
  favoritePositions: Map<string, string>;
  selectedId: string | null;
  draftId: string | null;
  canEdit: boolean;
  loading: boolean;
  /** The footer sub-view showing in place of the tree (null = the tree). */
  footerView: FooterView | null;
  onFooterViewChange: (view: FooterView | null) => void;
  onOpen: (id: string) => void;
  onWarm?: (id: string) => void;
  onNewCapture: () => void;
  onNewPage: () => void;
  onCreateChild: (parentId: string) => void;
  onDropIntent: (intent: DropIntent) => void;
  onUnarchive: (id: string) => void;
  onTrash: (id: string) => void;
  onUnfavorite: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onSearch?: (query: string) => Promise<NoteSearchResult[]>;
  onImport?: () => void;
};

export function NotesSidebar(props: NotesSidebarProps) {
  const { sections, canEdit, selectedId, notes } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded(props.workspaceId));
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const view = props.footerView;
  const setView = props.onFooterViewChange;
  const treeRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const search = useNoteSearch(props.onSearch);
  const drag = useSidebarDrag({
    notes,
    sections,
    favoritePositions: props.favoritePositions,
    onDrop: (intent) => {
      props.onDropIntent(intent);
      // A note dropped into a collapsed page shows where it went.
      if (intent.kind === "move" && intent.parentId) {
        toggle(rowKey("inbox", intent.parentId), true);
        toggle(rowKey("pages", intent.parentId), true);
      }
    },
    scrollerRef,
  });
  const dragNote = drag.dragNoteId ? notes.find((n) => n.id === drag.dragNoteId) : undefined;

  const toggle = useCallback(
    (key: string, open?: boolean) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open ?? !next.has(key)) next.add(key);
        else next.delete(key);
        writeExpanded(props.workspaceId, next);
        return next;
      }),
    [props.workspaceId],
  );

  // The open note is always visible: expand its ancestors in both sections.
  useEffect(() => {
    if (!selectedId) return;
    const byId = new Map(notes.map((n) => [n.id, n]));
    const keys: string[] = [];
    let cur = byId.get(selectedId)?.parentId ?? null;
    for (let i = 0; cur && i < 100; i++) {
      keys.push(rowKey("inbox", cur), rowKey("pages", cur));
      cur = byId.get(cur)?.parentId ?? null;
    }
    if (keys.length === 0) return;
    setExpanded((prev) => (keys.every((k) => prev.has(k)) ? prev : new Set([...prev, ...keys])));
  }, [selectedId, notes]);

  const rows = useMemo(() => visibleRows(sections, expanded), [sections, expanded]);
  const favoriteIds = useMemo(() => new Set(sections.favorites.map((n) => n.id)), [sections]);
  const effectiveFocus =
    focusedKey && rows.some((r) => r.key === focusedKey)
      ? focusedKey
      : (rows.find((r) => r.id === selectedId)?.key ?? rows[0]?.key ?? null);

  const focusRow = (key: string) => {
    setFocusedKey(key);
    treeRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.focus();
  };

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Only the treeitem itself; a row's menu or button handles its own keys.
    const target = e.target as HTMLElement;
    if (!target.matches('[role="treeitem"]')) return;
    const current = target.dataset.rowKey ?? effectiveFocus;
    const action = treeKeyAction(rows, current, e, { canEdit });
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    switch (action.type) {
      case "focus":
        focusRow(action.key);
        break;
      case "expand":
        toggle(action.key, true);
        break;
      case "collapse":
        toggle(action.key, false);
        break;
      case "open":
        props.onOpen(action.id);
        break;
      case "trash": {
        const note = notes.find((n) => n.id === action.id);
        if (!note || action.id === props.draftId) break;
        // In the personal Favorites list ⌫ only un-favorites; it never trashes
        // the shared note.
        const inFavorites = current?.startsWith("favorites:") ?? false;
        // Keep keyboard focus in the tree: move to a neighbour first.
        const idx = rows.findIndex((r) => r.key === current);
        // Skip rows trashed with it: the same note, or anything under it.
        const parentOf = new Map(rows.map((r) => [r.key, r.parentKey]));
        const goesWithIt = (key: string) => {
          for (let k: string | null = key, i = 0; k && i < 100; k = parentOf.get(k) ?? null, i++) {
            if (k === current || rows.find((r) => r.key === k)?.id === note.id) return true;
          }
          return false;
        };
        const next =
          rows.slice(idx + 1).find((r) => !goesWithIt(r.key)) ??
          rows
            .slice(0, Math.max(idx, 0))
            .reverse()
            .find((r) => !goesWithIt(r.key));
        if (next) focusRow(next.key);
        if (inFavorites) props.onUnfavorite(note.id);
        else {
          props.onTrash(note.id);
          // Deleting the open note opens the next one, not an empty pane.
          if (note.id === selectedId && next) props.onOpen(next.id);
        }
        break;
      }
      case "reorder": {
        const row = rows.find((r) => r.key === action.key);
        if (!row) break;
        const section = row.key.split(":")[0] as SidebarSection;
        const intent = keyboardReorderIntent({
          notes,
          layout: sections,
          favoritePositions: props.favoritePositions,
          section,
          noteId: row.id,
          siblingIds: rows
            .filter((r) => r.parentKey === row.parentKey && r.key.startsWith(`${section}:`))
            .map((r) => r.id),
          direction: action.direction,
          pos: { endPosition, betweenPositions },
        });
        if (intent) props.onDropIntent(intent);
        break;
      }
    }
  };

  const ctx: TreeCtx = {
    selectedId,
    focusedKey: effectiveFocus,
    draftId: props.draftId,
    canEdit,
    favoriteIds,
    expanded,
    hover: drag.hover,
    dragging: drag.dragging,
    onToggle: (key) => toggle(key),
    onOpen: props.onOpen,
    onWarm: props.onWarm,
    onFocusRow: setFocusedKey,
    onCreateChild: props.onCreateChild,
  };

  const footerItem = (target: FooterView, icon: LucideIcon, label: string) => ({
    icon,
    label,
    active: view === target,
    onSelect: () => setView(view === target ? null : target),
  });

  const inboxCount = sections.inbox.length;
  const showSkeleton = props.loading && notes.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {view ? (
        <FooterSubView
          view={view}
          footer={sections.footer}
          selectedId={selectedId}
          canEdit={canEdit}
          onBack={() => setView(null)}
          onOpen={props.onOpen}
          onUnarchive={props.onUnarchive}
          onTrash={props.onTrash}
          onRestore={props.onRestore}
          onPurge={props.onPurge}
        />
      ) : (
        <>
          {props.onSearch ? (
            <SidebarSearchInput query={search.query} onChange={search.setQuery} />
          ) : null}
          <div
            ref={scrollerRef}
            className="pane-scroll scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 pb-4"
          >
            {search.active ? (
              <SidebarSearchResults
                results={search.results}
                searching={search.searching}
                failed={search.failed}
                selectedId={selectedId}
                onOpen={props.onOpen}
              />
            ) : showSkeleton ? (
              <SkeletonRows />
            ) : (
              <div
                ref={treeRef}
                role="tree"
                aria-label="Notes"
                onKeyDown={onTreeKeyDown}
                className="flex flex-col gap-3"
              >
                {sections.favorites.length > 0 ? (
                  <Section label="Favorites">
                    {sections.favorites.map((note) => (
                      <TreeRow
                        key={rowKey("favorites", note.id)}
                        note={note}
                        section="favorites"
                        depth={0}
                        expandable={false}
                        expanded={false}
                        ctx={ctx}
                      />
                    ))}
                  </Section>
                ) : null}
                <Section
                  label="Inbox"
                  dropSection="inbox"
                  dropActive={drag.headerHover === "inbox"}
                  count={inboxCount}
                  countLabel={`${inboxCount} in Inbox`}
                  onAdd={canEdit ? props.onNewCapture : undefined}
                  addLabel="New note (⌘N)"
                >
                  {inboxCount === 0 ? (
                    // An empty section's line takes a drop like its header.
                    <p data-drop-header="inbox" className="px-2 py-1 text-xs text-muted-foreground">
                      Captures land here.
                    </p>
                  ) : (
                    <TreeNodes nodes={sections.inbox} section="inbox" depth={0} ctx={ctx} />
                  )}
                </Section>
                <Section
                  label="Pages"
                  dropSection="pages"
                  dropActive={drag.headerHover === "pages"}
                  onAdd={canEdit ? props.onNewPage : undefined}
                  addLabel="New page"
                >
                  {sections.pages.length === 0 ? (
                    <p
                      data-drop-header="pages"
                      className={cn(
                        "px-2 py-1 text-xs text-muted-foreground",
                        drag.headerHover === "pages" && DROP_TARGET,
                      )}
                    >
                      File a note here to keep it.
                    </p>
                  ) : (
                    <TreeNodes nodes={sections.pages} section="pages" depth={0} ctx={ctx} />
                  )}
                </Section>
              </div>
            )}
          </div>
        </>
      )}
      {/* Tasks' footer (MOD-140): the places under the tree, pinned. */}
      <SidebarFooter
        label="Published, archive and trash"
        className="mt-2 px-1 pt-2"
        items={[
          footerItem("archive", Archive, "Archived"),
          footerItem("trash", Trash2, "Recently deleted"),
          ...(footerCounts(sections.footer).published > 0
            ? [{ ...footerItem("published", Globe, "Published"), iconOnly: true }]
            : []),
          ...(props.onImport
            ? [{ icon: Import, label: "Import", onSelect: props.onImport, iconOnly: true }]
            : []),
        ]}
      />
      {/* What follows the pointer. pointer-events-none is load-bearing: the
          drop is hit-tested with elementFromPoint, which must see the row
          under the overlay, not the overlay. */}
      <DragOverlay dropAnimation={null} className="pointer-events-none">
        {dragNote ? (
          <DragOverlaySurface className="max-w-56 text-sm">
            {dragNote.icon ? (
              <span className="text-sm leading-none">{dragNote.icon}</span>
            ) : (
              <FileText aria-hidden className="size-icon-sm text-muted-foreground" />
            )}
            <span className="truncate">{displayTitle(dragNote.title)}</span>
          </DragOverlaySurface>
        ) : null}
      </DragOverlay>
    </div>
  );
}

function Section({
  label,
  dropSection,
  dropActive = false,
  count,
  countLabel,
  onAdd,
  addLabel,
  children,
}: {
  label: string;
  dropSection?: "inbox" | "pages";
  dropActive?: boolean;
  count?: number;
  countLabel?: string;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}) {
  return (
    <div role="none">
      <NavSectionHeader
        role="none"
        label={label}
        count={count}
        countLabel={countLabel}
        onAdd={onAdd}
        addLabel={addLabel}
        data-drop-header={dropSection}
        className={cn(dropActive && DROP_TARGET)}
      />
      <div role="group" aria-label={label} className="flex flex-col gap-px">
        {children}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-busy="true" aria-label="Loading notes" className="flex flex-col gap-1 px-1 pt-1">
      {["w-3/4", "w-1/2", "w-2/3", "w-2/5"].map((w) => (
        <div key={w} className="flex h-(--row-h) items-center gap-2 px-2">
          <Skeleton className="size-icon-sm" />
          <Skeleton className={cn("h-3", w)} />
        </div>
      ))}
    </div>
  );
}

/** The rows a keyboard walk visits, in screen order. */
export function visibleRows(sections: SidebarSections, expanded: ReadonlySet<string>): KeyRow[] {
  const out: KeyRow[] = [];
  for (const note of sections.favorites) {
    out.push({
      key: rowKey("favorites", note.id),
      id: note.id,
      parentKey: null,
      expandable: false,
      expanded: false,
    });
  }
  const walk = (nodes: NoteTreeNode[], section: SidebarSection, parentKey: string | null) => {
    for (const node of nodes) {
      const key = rowKey(section, node.note.id);
      const expandable = node.children.length > 0;
      const open = expandable && expanded.has(key);
      out.push({ key, id: node.note.id, parentKey, expandable, expanded: open });
      if (open) walk(node.children, section, key);
    }
  };
  walk(sections.inbox, "inbox", null);
  walk(sections.pages, "pages", null);
  return out;
}

// ── expansion persistence (per workspace, this device) ──────────────────────

function expandKey(workspaceId: string): string {
  return `moduo:notes-next:expanded:v1:${workspaceId}`;
}

function readExpanded(workspaceId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(expandKey(workspaceId));
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeExpanded(workspaceId: string, expanded: Set<string>) {
  try {
    window.localStorage.setItem(expandKey(workspaceId), JSON.stringify([...expanded]));
  } catch {
    // a lost expansion state is not worth surfacing
  }
}
