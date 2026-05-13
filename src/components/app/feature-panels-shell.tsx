import { useEffect, useState, type ReactNode } from "react";
import {
  LAYOUT_PANELS_APPLY_EVENT,
  readFeaturePanelState,
  type FeatureLayoutKey,
  type LayoutPanelsApplyDetail,
} from "../../features/layout/panel-events";
import { Sheet, SheetContent } from "../ui/sheet";

type Props = {
  feature: FeatureLayoutKey;
  center: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  /** When true the right panel is never rendered, regardless of saved state */
  hideRight?: boolean;
};

type RailMode = "full" | "icon" | "sheet" | "hidden";

const BP_NARROW = 900;
const BP_RAIL_COLLAPSE = 1024;
const BP_FULL = 1280;

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? BP_FULL : window.innerWidth,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function resolveMode(viewport: number, requested: boolean, kind: "left" | "right"): RailMode {
  if (!requested) return "hidden";
  if (viewport < BP_NARROW) return "sheet";
  if (kind === "right" && viewport < BP_FULL) return "icon";
  if (kind === "left" && viewport < BP_RAIL_COLLAPSE) return "icon";
  return "full";
}

export function FeaturePanelsShell({ feature, center, left, right, hideRight = false }: Props) {
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
  const leftMode = resolveMode(viewport, panelState.left, "left");
  const rightMode = resolveMode(viewport, showRight, "right");

  useEffect(() => {
    if (leftMode === "sheet" && panelState.left) setLeftSheetOpen(true);
    else setLeftSheetOpen(false);
  }, [leftMode, panelState.left]);

  useEffect(() => {
    if (rightMode === "sheet" && showRight) setRightSheetOpen(true);
    else setRightSheetOpen(false);
  }, [rightMode, showRight]);

  const leftPanel =
    leftMode === "full" || leftMode === "icon" ? (
      <aside
        className="min-h-0 min-w-0 h-full rounded-2xl border border-border bg-card p-5 flex flex-col overflow-hidden"
        style={{
          width: leftMode === "icon" ? "var(--width-sidebar-icon)" : "var(--width-sidebar)",
          flex: "0 0 auto",
        }}
        data-rail-mode={leftMode}
      >
        {left ?? <div className="text-sm text-muted-foreground">Feature tools panel</div>}
      </aside>
    ) : null;

  const rightPanel =
    rightMode === "full" || rightMode === "icon" ? (
      <aside
        className="min-h-0 min-w-0 h-full rounded-2xl bg-card p-4 border border-border"
        style={{
          width: rightMode === "icon" ? "var(--width-rail-icon)" : "var(--width-rail)",
          flex: "0 0 auto",
        }}
        data-rail-mode={rightMode}
      >
        {right ?? (
          <div className="text-sm text-muted-foreground">Graph relations tree, feature coming soon.</div>
        )}
      </aside>
    ) : null;

  return (
    <>
      <div className="flex h-full min-h-0 gap-4 bg-background px-4">
        {leftPanel}
        <main className="min-h-0 min-w-0 h-full flex-1 rounded-2xl bg-card p-4 overflow-auto relative border border-border">
          {center}
        </main>
        {rightPanel}
      </div>

      <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
        <SheetContent side="left" className="w-[var(--width-sidebar)] max-w-[85vw] p-5">
          {left ?? <div className="text-sm text-muted-foreground">Feature tools panel</div>}
        </SheetContent>
      </Sheet>

      <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
        <SheetContent side="right" className="w-[var(--width-rail)] max-w-[85vw] p-4">
          {right ?? (
            <div className="text-sm text-muted-foreground">Graph relations tree, feature coming soon.</div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
