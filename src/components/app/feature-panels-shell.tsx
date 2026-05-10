import { useEffect, useState, type ReactNode } from "react";
import {
  LAYOUT_PANELS_APPLY_EVENT,
  readFeaturePanelState,
  type FeatureLayoutKey,
  type LayoutPanelsApplyDetail,
} from "../../features/layout/panel-events";

type Props = {
  feature: FeatureLayoutKey;
  center: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  /** When true the right panel is never rendered, regardless of saved state */
  hideRight?: boolean;
};

export function FeaturePanelsShell({ feature, center, left, right, hideRight = false }: Props) {
  const [panelState, setPanelState] = useState(() => readFeaturePanelState(feature));

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

  const layoutColumns = panelState.left
    ? showRight
      ? "grid-cols-[minmax(340px,22fr)_48fr_30fr]"
      : "grid-cols-[minmax(340px,24fr)_76fr]"
    : showRight
      ? "grid-cols-[70fr_30fr]"
      : "grid-cols-[1fr]";

  return (
    <div className={`grid h-full min-h-0 gap-4 bg-[#0C0C0C] px-4 pb-2 pt-2 ${layoutColumns}`}>
      {panelState.left ? (
        <aside className="min-h-0 min-w-0 h-full rounded-2xl border border-[#1b1b1b] bg-[#111111] p-5 flex flex-col overflow-hidden">
          {left ?? <div className="text-[#8f8f8f] text-[13px]">Feature tools panel</div>}
        </aside>
      ) : null}

      <main className="min-h-0 min-w-0 h-full rounded-2xl bg-[#111111] p-4 overflow-auto relative">{center}</main>

      {showRight ? (
        <aside className="min-h-0 min-w-0 h-full rounded-2xl bg-[#111111] p-4">
          {right ?? (
            <div className="text-[#9a9a9a] text-[13px]">Graph relations tree, feature coming soon.</div>
          )}
        </aside>
      ) : null}
    </div>
  );
}
