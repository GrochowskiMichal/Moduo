import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  dispatchLayoutPanelsSet,
  type FeatureLayoutKey,
  LAYOUT_PANELS_APPLY_EVENT,
  type LayoutPanelsApplyDetail,
  readFeaturePanelState,
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
  /**
   * When false, the side panels render as fixed-width columns (no drag
   * handles, no per-feature width persistence). Defaults to true.
   */
  resizable?: boolean;
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
  "min-h-0 min-w-0 h-full w-full rounded-xl border border-border bg-card flex flex-col overflow-hidden";
const CENTER_WRAPPER =
  "min-h-0 min-w-0 h-full w-full rounded-xl border border-border bg-card overflow-auto relative";

// Density-driven, uniform padding (responds to Appearance → density). Uniform so
// content sits equidistant from every panel edge. Rails run tighter than center.
const RAIL_PAD = { padding: "var(--pad-x-sm)" } as const;
const CENTER_PAD = { padding: "var(--pad-x)" } as const;

export function FeaturePanelsShell({
  feature,
  center,
  left,
  right,
  hideRight = false,
  resizable = true,
}: Props) {
  const [panelState, setPanelState] = useState(() => readFeaturePanelState(feature));
  const viewport = useViewportWidth();

  // Snapshot the user's full-mode preference so we can restore it when the
  // viewport grows back. While in sheet mode the panels are forced closed
  // (no auto-open); the user re-opens via the toggle.
  const fullModePreferenceRef = useRef<{ left: boolean; right: boolean }>({
    left: panelState.left,
    right: panelState.right,
  });
  const lastViewportModeRef = useRef<"full" | "sheet" | "init">("init");

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
  const viewportMode: "full" | "sheet" = viewport < BP_NARROW ? "sheet" : "full";

  // Drive transitions between full and sheet viewport modes.
  useEffect(() => {
    const prev = lastViewportModeRef.current;
    lastViewportModeRef.current = viewportMode;

    if (prev === "init") {
      if (viewportMode === "full") {
        fullModePreferenceRef.current = {
          left: panelState.left,
          right: panelState.right,
        };
      }
      return;
    }

    if (prev === "full" && viewportMode === "sheet") {
      fullModePreferenceRef.current = {
        left: panelState.left,
        right: panelState.right,
      };
      // Force-close in sheet mode so the sheet doesn't pop open just because
      // the panel was open at full width. User re-opens via the toggle.
      setLeftSheetOpen(false);
      setRightSheetOpen(false);
      if (panelState.left || panelState.right) {
        dispatchLayoutPanelsSet({ feature, left: false, right: false });
      }
      return;
    }

    if (prev === "sheet" && viewportMode === "full") {
      const restored = fullModePreferenceRef.current;
      if (panelState.left !== restored.left || panelState.right !== restored.right) {
        dispatchLayoutPanelsSet({ feature, left: restored.left, right: restored.right });
      }
    }
  }, [feature, panelState.left, panelState.right, viewportMode]);

  // In full mode, snapshot the user's panel preference so a later
  // sheet-mode transition has the right values to restore.
  useEffect(() => {
    if (viewportMode === "full") {
      fullModePreferenceRef.current = {
        left: panelState.left,
        right: panelState.right,
      };
    }
  }, [panelState.left, panelState.right, viewportMode]);

  // Sheet open state mirrors panelState in sheet mode. When user clicks the
  // toggle, panelState flips → sheet opens. When user clicks outside or
  // presses Escape, the Sheet's onOpenChange syncs panelState back to false
  // (see onLeftSheetOpenChange / onRightSheetOpenChange below) so the toggle
  // button isn't a click behind.
  useEffect(() => {
    if (viewportMode !== "sheet") return;
    setLeftSheetOpen(panelState.left);
  }, [panelState.left, viewportMode]);

  useEffect(() => {
    if (viewportMode !== "sheet") return;
    setRightSheetOpen(showRight);
  }, [showRight, viewportMode]);

  const onLeftSheetOpenChange = useCallback(
    (next: boolean) => {
      setLeftSheetOpen(next);
      if (!next && panelState.left) {
        dispatchLayoutPanelsSet({
          feature,
          left: false,
          right: panelState.right,
        });
      }
    },
    [feature, panelState.left, panelState.right],
  );

  const onRightSheetOpenChange = useCallback(
    (next: boolean) => {
      setRightSheetOpen(next);
      if (!next && panelState.right) {
        dispatchLayoutPanelsSet({
          feature,
          left: panelState.left,
          right: false,
        });
      }
    },
    [feature, panelState.left, panelState.right],
  );

  const showLeftFull = viewportMode === "full" && panelState.left;
  const showRightFull = viewportMode === "full" && showRight;

  const leftSlot = left ?? <div className="text-sm text-muted-foreground">Feature tools panel</div>;
  const rightSlot = right ?? <div className="text-sm text-muted-foreground">Details panel</div>;

  const layoutKey = `${LAYOUT_STORAGE_PREFIX}:${feature}:${showLeftFull ? "l" : "-"}${showRightFull ? "r" : "-"}`;
  const defaultLayout = useMemo<Layout | undefined>(
    () => (resizable ? readPersistedLayout(layoutKey) : undefined),
    [layoutKey, resizable],
  );

  const onLayoutChanged = useCallback(
    (layout: Layout) => {
      if (!resizable) return;
      writePersistedLayout(layoutKey, layout);
    },
    [layoutKey, resizable],
  );

  const panels = (
    <ResizablePanelGroup
      key={layoutKey}
      direction="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      disabled={!resizable}
      className="gap-0"
    >
      {showLeftFull ? (
        <ResizablePanel
          id={`${feature}-left`}
          defaultSize="20%"
          minSize={resizable ? "240px" : "20%"}
          maxSize={resizable ? "40%" : "20%"}
        >
          <aside className={RAIL_WRAPPER} data-rail-mode="full" style={RAIL_PAD}>
            {leftSlot}
          </aside>
        </ResizablePanel>
      ) : null}

      {showLeftFull ? <ResizableHandle /> : null}

      <ResizablePanel id={`${feature}-center`} defaultSize="60%" minSize="30%">
        <main className={CENTER_WRAPPER} style={CENTER_PAD}>
          {center}
        </main>
      </ResizablePanel>

      {showRightFull ? <ResizableHandle /> : null}

      {showRightFull ? (
        <ResizablePanel
          id={`${feature}-right`}
          defaultSize="20%"
          minSize={resizable ? "240px" : "20%"}
          maxSize={resizable ? "40%" : "20%"}
        >
          <aside className={RAIL_WRAPPER} data-rail-mode="full" style={RAIL_PAD}>
            {rightSlot}
          </aside>
        </ResizablePanel>
      ) : null}
    </ResizablePanelGroup>
  );

  return (
    <>
      <div className="flex h-full min-h-0 bg-background px-4">{panels}</div>

      <Sheet open={leftSheetOpen} onOpenChange={onLeftSheetOpenChange}>
        <SheetContent side="left" className="w-[var(--width-sidebar)] max-w-[85vw] p-5">
          {leftSlot}
        </SheetContent>
      </Sheet>

      <Sheet open={rightSheetOpen} onOpenChange={onRightSheetOpenChange}>
        <SheetContent side="right" className="w-[var(--width-rail)] max-w-[85vw] p-4">
          {rightSlot}
        </SheetContent>
      </Sheet>
    </>
  );
}
