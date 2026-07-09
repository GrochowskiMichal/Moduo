import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useWorkspace } from "@/features/workspaces/workspace-context";
import { getRuntime } from "@/lib/runtime";
import type { RuntimeCapabilities } from "@/lib/runtime.types";

import { DashboardDataProvider } from "../context/dashboard-data-context";
import { WidgetActionsProvider } from "../context/widget-actions-context";
import {
  DASHBOARD_OPEN_GALLERY_EVENT,
  DASHBOARD_PAGE_ACTION_EVENT,
  DASHBOARD_TOGGLE_EDIT_EVENT,
  type DashboardPageAction,
  dispatchDashboardEditChanged,
  dispatchDashboardPager,
} from "../edit-mode-events";
import { removeWidget, resizeWidget } from "../engine/grid-engine";
import type { WidgetSize, WidgetType } from "../engine/types";
import { galleryTypes } from "../registry/catalog";
import { useDashboardLayout } from "../hooks/use-dashboard-layout";
import { useEditMode } from "../hooks/use-edit-mode";
import { useGridDrag } from "../hooks/use-grid-drag";
import { DashboardPager } from "./dashboard-pager";
import { GalleryDialog } from "./gallery-dialog";
import { GridSkeleton } from "./grid-skeleton";

const WEB_FALLBACK_CAPS: RuntimeCapabilities = {
  isDesktop: false,
  isWeb: true,
  hasEmail: false,
  hasTimeTracking: false,
  hasCalendarOAuth: false,
  hasLocalMnemonic: false,
  hasOfflineMode: false,
};

/**
 * The Home feature root. Full-bleed — it owns the whole content area (no
 * FeaturePanelsShell, no left/right rails; the grid IS the page, per the spec).
 *
 * DB-4 makes the layout real: {@link useDashboardLayout} loads it per
 * user+workspace (cache-first, cloud-synced, seeded default), and the surface
 * becomes multi-page — a horizontal pager with dots / arrow-keys / trackpad-swipe
 * navigation and edit-mode page CRUD. DB-3's edit mode + drag now operate on the
 * active page; DB-5 puts real data behind each frame.
 */
export function DashboardPage() {
  const dash = useDashboardLayout();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const editMode = useEditMode();
  const { editing, exit, enter, toggle } = editMode;
  const [galleryOpen, setGalleryOpen] = useState(false);

  // The types offered in the Add gallery — permission + platform filtered (AC8/AC9).
  const galleryAvailable = useMemo<WidgetType[]>(() => {
    const caps = getRuntime()?.capabilities ?? WEB_FALLBACK_CAPS;
    return galleryTypes(
      { tasks: modulePermissions.tasks, notes: modulePermissions.notes },
      caps,
    );
  }, [modulePermissions.tasks, modulePermissions.notes]);

  const onAddWidget = (type: WidgetType, size: WidgetSize): boolean => {
    const added = dash.tryAddWidget(type, size);
    return added;
  };
  const onAddWidgetToNewPage = (type: WidgetType, size: WidgetSize) => {
    dash.addWidgetToNewPage(type, size);
    toast("Added to a new page");
  };

  const activePage = dash.layout.pages[dash.activeIndex] ?? dash.layout.pages[0];
  const { goToIndex, activeIndex, addPage, removePage } = dash;
  const pageCount = dash.layout.pages.length;

  const { gridRef, drag, startWidgetDrag } = useGridDrag({
    widgets: activePage.widgets,
    editing,
    onCommit: (next) => dash.commitWidgets(activePage.id, next),
    onLongPress: enter,
  });

  const onRemove = (id: string) =>
    dash.commitWidgets(activePage.id, removeWidget(activePage.widgets, id));
  // A resize that can't fit anywhere keeps the current size (spec edge case).
  const onResize = (id: string, size: WidgetSize) =>
    dash.commitWidgets(activePage.id, resizeWidget(activePage.widgets, id, size) ?? activePage.widgets);

  // Escape exits edit mode. An in-flight drag consumes Escape first (capture
  // phase in the drag hook) and stops it, so this only fires when idle-editing.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) exit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, exit]);

  // The Edit/Done control lives in the app-chrome bottom bar (the panel-toggle
  // slot, empty on Home). Broadcast our state so it renders the right icon, and
  // take its toggle presses. DashboardPage stays the sole owner of edit mode.
  useEffect(() => {
    dispatchDashboardEditChanged(editing);
  }, [editing]);
  useEffect(() => {
    const onToggle = () => toggle();
    window.addEventListener(DASHBOARD_TOGGLE_EDIT_EVENT, onToggle);
    return () => window.removeEventListener(DASHBOARD_TOGGLE_EDIT_EVENT, onToggle);
  }, [toggle]);

  // The edit-mode "Add" control (app-chrome) opens the gallery (AC9).
  useEffect(() => {
    const onOpen = () => setGalleryOpen(true);
    window.addEventListener(DASHBOARD_OPEN_GALLERY_EVENT, onOpen);
    return () => window.removeEventListener(DASHBOARD_OPEN_GALLERY_EVENT, onOpen);
  }, []);

  // The page dots live in the app-chrome bottom-bar LEFT slot. Broadcast the
  // pager shape so they render, and handle the actions they dispatch back.
  const activePageId = activePage.id;
  useEffect(() => {
    dispatchDashboardPager({ count: pageCount, activeIndex });
  }, [pageCount, activeIndex]);
  useEffect(() => {
    const onAction = (e: Event) => {
      const action = (e as CustomEvent<DashboardPageAction>).detail;
      if (!action) return;
      if (action.type === "goto") goToIndex(action.index);
      else if (action.type === "add") addPage();
      else if (action.type === "remove") removePage(activePageId);
    };
    window.addEventListener(DASHBOARD_PAGE_ACTION_EVENT, onAction);
    return () => window.removeEventListener(DASHBOARD_PAGE_ACTION_EVENT, onAction);
  }, [goToIndex, addPage, removePage, activePageId]);

  // ←/→ turn pages (AC5) — ignored while typing or with a modifier held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      goToIndex(activeIndex + (e.key === "ArrowRight" ? 1 : -1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goToIndex, activeIndex]);

  return (
    <DashboardDataProvider layout={dash.layout} workspaceId={selectedWorkspaceId}>
      <WidgetActionsProvider actions={{ updateConfig: dash.updateWidgetConfig }}>
        <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
          {/* Right-click → Edit/Done. Desktop-only surface: on a touchscreen Radix's
              own long-press-to-open (~700ms) would race the drag hook's long-press-
              to-edit (450ms); mobile is out of scope, so this stays a known latent. */}
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                {dash.loading ? (
                  <GridSkeleton />
                ) : (
                  <DashboardPager
                    layout={dash.layout}
                    activeIndex={dash.activeIndex}
                    editing={editing}
                    drag={drag}
                    gridRef={gridRef}
                    onWidgetPointerDown={startWidgetDrag}
                    onRemove={onRemove}
                    onResize={onResize}
                    onPage={(dir) => dash.goToIndex(dash.activeIndex + dir)}
                  />
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={editing ? exit : enter}>
                {editing ? "Done editing" : "Edit dashboard"}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <GalleryDialog
            open={galleryOpen}
            onOpenChange={setGalleryOpen}
            available={galleryAvailable}
            onAdd={onAddWidget}
            onAddToNewPage={onAddWidgetToNewPage}
          />
        </div>
      </WidgetActionsProvider>
    </DashboardDataProvider>
  );
}
