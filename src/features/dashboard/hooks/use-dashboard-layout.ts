import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useWorkspace } from "@/features/workspaces/workspace-context";
import { getRuntime } from "@/lib/runtime";

import { createLayoutRepo } from "../data/layout-repo";
import { createDefaultLayout } from "../engine/default-layout";
import {
  addPage as addPageOp,
  addWidget as addWidgetOp,
  removePage as removePageOp,
  sanitizeLayout,
  setPageWidgets,
  updateWidgetConfig as updateWidgetConfigOp,
} from "../engine/grid-engine";
import type { DashboardLayout, WidgetInstance, WidgetSize, WidgetType } from "../engine/types";
import { newWidgetInstance } from "../registry/instance";

/** Per-device active-page memory (decision 12 — never synced, avoids cross-device flips). */
const ACTIVE_PAGE_PREFIX = "moduo:dashboard:active-page:";

function readActivePage(workspaceId: string, layout: DashboardLayout): string {
  const fallback = layout.pages[0]?.id ?? "home";
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(ACTIVE_PAGE_PREFIX + workspaceId);
    if (stored && layout.pages.some((p) => p.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeActivePage(workspaceId: string, pageId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_PAGE_PREFIX + workspaceId, pageId);
  } catch {
    /* ignore */
  }
}

function newPageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for a webview without crypto.randomUUID (none of our targets) — a
  // random suffix keeps it collision-free even against a persisted `page-N` id.
  return `page-${Math.floor(performance.now())}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export interface DashboardLayoutApi {
  layout: DashboardLayout;
  loading: boolean;
  activePageId: string;
  activeIndex: number;
  setActivePage: (pageId: string) => void;
  goToIndex: (index: number) => void;
  commitWidgets: (pageId: string, widgets: WidgetInstance[]) => void;
  /** Merge a config patch into a widget (by id), position-preserving (DB-6). */
  updateWidgetConfig: (widgetId: string, patch: Record<string, unknown>) => void;
  /** Add a widget to the active page; false when it can't fit (AC9 → offer a new page). */
  tryAddWidget: (type: WidgetType, size: WidgetSize) => boolean;
  /** Add a widget to a fresh page and jump to it (AC9's "add to a new page"). */
  addWidgetToNewPage: (type: WidgetType, size: WidgetSize) => void;
  addPage: () => void;
  removePage: (pageId: string) => void;
}

/**
 * The dashboard layout state (DB-4): loads per user+workspace from the cache-first
 * repo, seeds the curated default for a fresh user, persists every change (local
 * immediate + debounced cloud), and owns the device-local active page + page CRUD.
 * The whole layout is one atomic composition — every mutation replaces it and
 * saves it whole (LWW).
 */
export function useDashboardLayout(): DashboardLayoutApi {
  const { selectedWorkspaceId } = useWorkspace();
  const repo = useMemo(() => {
    const runtime = getRuntime();
    return runtime ? createLayoutRepo(runtime) : null;
  }, []);

  const [layout, setLayout] = useState<DashboardLayout>(() => sanitizeLayout(createDefaultLayout()));
  const [loading, setLoading] = useState(true);
  const [activePageId, setActivePageId] = useState<string>(() => layout.pages[0]?.id ?? "home");

  const layoutRef = useRef(layout);
  const activePageIdRef = useRef(activePageId);
  const workspaceRef = useRef<string | null>(selectedWorkspaceId);
  useEffect(() => {
    layoutRef.current = layout;
    activePageIdRef.current = activePageId;
    workspaceRef.current = selectedWorkspaceId;
  });

  // Load on workspace change — flush the previous workspace's pending save first.
  useEffect(() => {
    if (!repo || !selectedWorkspaceId) return;
    let cancelled = false;
    setLoading(true);
    void repo.flush().then(async () => {
      const loaded = await repo.load(selectedWorkspaceId);
      if (cancelled) return;
      setLayout(loaded.layout);
      setActivePageId(readActivePage(selectedWorkspaceId, loaded.layout));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, selectedWorkspaceId]);

  // Flush pending saves when the tab hides / unloads / this surface unmounts.
  // Best-effort on pagehide (the browser won't await a dangling promise) — but the
  // edit is already in the local cache, and a cache-wins load reconciles it up to
  // the cloud next session (layout-repo), so a cut-off flush is stale-not-lost.
  useEffect(() => {
    if (!repo) return;
    const flush = () => {
      void repo.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [repo]);

  const persist = useCallback(
    (next: DashboardLayout) => {
      setLayout(next);
      layoutRef.current = next;
      const ws = workspaceRef.current;
      if (repo && ws) void repo.save(ws, next);
    },
    [repo],
  );

  const setActivePage = useCallback((pageId: string) => {
    setActivePageId(pageId);
    const ws = workspaceRef.current;
    if (ws) writeActivePage(ws, pageId);
  }, []);

  const goToIndex = useCallback(
    (index: number) => {
      const pages = layoutRef.current.pages;
      const page = pages[Math.max(0, Math.min(pages.length - 1, index))];
      if (page) setActivePage(page.id);
    },
    [setActivePage],
  );

  const commitWidgets = useCallback(
    (pageId: string, widgets: WidgetInstance[]) => {
      persist(setPageWidgets(layoutRef.current, pageId, widgets));
    },
    [persist],
  );

  const updateWidgetConfig = useCallback(
    (widgetId: string, patch: Record<string, unknown>) => {
      persist(updateWidgetConfigOp(layoutRef.current, widgetId, patch));
    },
    [persist],
  );

  const tryAddWidget = useCallback(
    (type: WidgetType, size: WidgetSize): boolean => {
      const layout = layoutRef.current;
      const active =
        layout.pages.find((p) => p.id === activePageIdRef.current) ?? layout.pages[0];
      if (!active) return false;
      const placed = addWidgetOp(active.widgets, newWidgetInstance(type, size));
      if (!placed) return false; // page full — the caller offers a new page (AC9)
      persist(setPageWidgets(layout, active.id, placed));
      return true;
    },
    [persist],
  );

  const addWidgetToNewPage = useCallback(
    (type: WidgetType, size: WidgetSize) => {
      const id = newPageId();
      const withPage = addPageOp(layoutRef.current, id);
      const page = withPage.pages.find((p) => p.id === id);
      const instance = newWidgetInstance(type, size);
      const placed = page ? (addWidgetOp(page.widgets, instance) ?? [instance]) : [instance];
      persist(setPageWidgets(withPage, id, placed));
      setActivePage(id);
    },
    [persist, setActivePage],
  );

  const addPage = useCallback(() => {
    const id = newPageId();
    persist(addPageOp(layoutRef.current, id));
    setActivePage(id); // jump to the fresh page
  }, [persist, setActivePage]);

  const removePage = useCallback(
    (pageId: string) => {
      const before = layoutRef.current;
      const next = removePageOp(before, pageId);
      if (next === before) return; // last-page guard / unknown id → no-op
      persist(next);
      if (activePageIdRef.current === pageId) {
        const idx = before.pages.findIndex((p) => p.id === pageId);
        const fallback = next.pages[Math.max(0, idx - 1)] ?? next.pages[0];
        if (fallback) setActivePage(fallback.id);
      }
    },
    [persist, setActivePage],
  );

  // Keep the active page valid if adoption/sanitize dropped it under us.
  useEffect(() => {
    if (!layout.pages.some((p) => p.id === activePageId)) {
      setActivePageId(layout.pages[0]?.id ?? "home");
    }
  }, [layout, activePageId]);

  const activeIndex = Math.max(0, layout.pages.findIndex((p) => p.id === activePageId));

  return {
    layout,
    loading,
    activePageId,
    activeIndex,
    setActivePage,
    goToIndex,
    commitWidgets,
    updateWidgetConfig,
    tryAddWidget,
    addWidgetToNewPage,
    addPage,
    removePage,
  };
}
