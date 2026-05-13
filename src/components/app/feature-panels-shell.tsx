import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  LAYOUT_PANELS_APPLY_EVENT,
  readFeaturePanelState,
  type FeatureLayoutKey,
  type LayoutPanelsApplyDetail,
} from "../../features/layout/panel-events";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable";
import { Sheet, SheetContent } from "../ui/sheet";

type Props = {
  feature: FeatureLayoutKey;
  center: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  /** When true the right panel is never rendered, regardless of saved state */
  hideRight?: boolean;
};

type RailMode = "full" | "sheet" | "hidden";
type Layout = Record<string, number>;

const BP_NARROW = 900;
const LAYOUT_STORAGE_PREFIX = "moduo:panels-layout:v2";

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function resolveMode(viewport: number, requested: boolean): RailMode {
  if (!requested) return "hidden";
  if (viewport < BP_NARROW) return "sheet";
  return "full";
}

function readPersistedLayout(key: string): Layout | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const entries = Object.entries(parsed);
    if (entries.length === 0) return undefined;
    for (const [, value] of entries) {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    }
    return parsed as Layout;
  } catch {
    return undefined;
  }
}

function writePersistedLayout(key: string, layout: Layout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    /* quota or storage disabled — non-fatal */
  }
}

const RAIL_WRAPPER =
  "min-h-0 min-w-0 h-full rounded-2xl border border-border bg-card p-5 flex flex-col overflow-hidden";
const CENTER_WRAPPER =
  "min-h-0 min-w-0 h-full rounded-2xl border border-border bg-card p-4 overflow-auto relative";

export function FeaturePanelsShell({
  feature,
  center,
  left,
  right,
  hideRight = false,
}: Props) {
  const [panelState, setPanelState] = useState(() => readFeaturePanelState(feature));
  const viewport = useViewportWidth();
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onApplyPanels = (event: Event) => {
      const detail = (event as CustomEvent<LayoutPanelsApplyDetail>).detail;
      if (detail?.feature !== feature) return;
      setPanelState({ left: detail.left, right: detail.right });
    };
    window.addEventListener(LAYOUT_PANELS_APPLY_EVENT, onApplyPanels);
    return () => window.removeEventListener(LAYOUT_PANELS_APPLY_EVENT, onApplyPanels);
  }, [feature]);

  const showRight = panelState.right && !hideRight;
  const leftMode = resolveMode(viewport, panelState.left);
  const rightMode = resolveMode(viewport, showRight);

  useEffect(() => {
    if (leftMode === "sheet" && panelState.left) setLeftSheetOpen(true);
    else setLeftSheetOpen(false);
  }, [leftMode, panelState.left]);

  useEffect(() => {
    if (rightMode === "sheet" && showRight) setRightSheetOpen(true);
    else setRightSheetOpen(false);
  }, [rightMode, showRight]);

  const showLeftFull = leftMode === "full";
  const showRightFull = rightMode === "full";

  const leftSlot = left ?? (
    <div className="text-sm text-muted-foreground">Feature tools panel</div>
  );
  const rightSlot = right ?? (
    <div className="text-sm text-muted-foreground">
      Graph relations tree, feature coming soon.
    </div>
  );

  const layoutKey = `${LAYOUT_STORAGE_PREFIX}:${feature}:${showLeftFull ? "l" : "-"}${showRightFull ? "r" : "-"}`;
  const defaultLayout = useMemo<Layout | undefined>(
    () => readPersistedLayout(layoutKey),
    [layoutKey],
  );

  const onLayoutChanged = useCallback(
    (layout: Layout) => {
      writePersistedLayout(layoutKey, layout);
    },
    [layoutKey],
  );

  return (
    <>
      <div className="flex h-full min-h-0 bg-background px-4">
        <ResizablePanelGroup
          key={layoutKey}
          direction="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="gap-2"
        >
          {showLeftFull ? (
            <ResizablePanel
              id={`${feature}-left`}
              defaultSize="20%"
              minSize="12%"
              maxSize="40%"
            >
              <aside className={RAIL_WRAPPER} data-rail-mode="full">
                {leftSlot}
              </aside>
            </ResizablePanel>
          ) : null}

          {showLeftFull ? <ResizableHandle /> : null}

          <ResizablePanel id={`${feature}-center`} defaultSize="60%" minSize="30%">
            <main className={CENTER_WRAPPER}>{center}</main>
          </ResizablePanel>

          {showRightFull ? <ResizableHandle /> : null}

          {showRightFull ? (
            <ResizablePanel
              id={`${feature}-right`}
              defaultSize="20%"
              minSize="12%"
              maxSize="40%"
            >
              <aside className={RAIL_WRAPPER} data-rail-mode="full">
                {rightSlot}
              </aside>
            </ResizablePanel>
          ) : null}
        </ResizablePanelGroup>
      </div>

      <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
        <SheetContent side="left" className="w-[var(--width-sidebar)] max-w-[85vw] p-5">
          {leftSlot}
        </SheetContent>
      </Sheet>

      <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
        <SheetContent side="right" className="w-[var(--width-rail)] max-w-[85vw] p-4">
          {rightSlot}
        </SheetContent>
      </Sheet>
    </>
  );
}
