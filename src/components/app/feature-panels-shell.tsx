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
};

export function FeaturePanelsShell({ feature, center, left, right }: Props) {
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

  const layoutColumns = panelState.left
    ? panelState.right
      ? "grid-cols-[20fr_50fr_30fr]"
      : "grid-cols-[20fr_80fr]"
    : panelState.right
      ? "grid-cols-[70fr_30fr]"
      : "grid-cols-[1fr]";

  return (
    <div className={`grid h-full min-h-0 gap-4 p-4 bg-[#0C0C0C] ${layoutColumns}`}>
      {panelState.left ? (
        <aside className="min-h-0 rounded-2xl bg-[#111111] p-4">
          {left ?? <div className="text-[#8f8f8f] text-[13px]">Feature tools panel</div>}
        </aside>
      ) : null}

      <main className="min-h-0 rounded-2xl bg-[#111111] p-4 overflow-auto">{center}</main>

      {panelState.right ? (
        <aside className="min-h-0 rounded-2xl bg-[#111111] p-4">
          {right ?? (
            <div className="text-[#9a9a9a] text-[13px]">Graph relations tree, feature coming soon.</div>
          )}
        </aside>
      ) : null}
    </div>
  );
}
