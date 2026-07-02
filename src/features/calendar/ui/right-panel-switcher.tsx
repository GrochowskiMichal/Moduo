// The right-panel variant switcher — the Moduo-wide IA principle's first
// adopter (DESIGN_BRIEF §5, decisions.md (e)): the right panel is a
// user-switchable surface with per-module hand-picked variants, never a
// hardcoded single purpose. Built inside Calendar but SHAPED FOR EXTRACTION:
// a typed variant registry + one header control. When the second module
// adopts it, lift this file (types + component, unchanged) into the app shell.

import type { ReactNode } from "react";

import { SegmentedControl } from "../../../components/ui/segmented-control";

/** One entry in a module's hand-picked right-panel variant list. */
export type RightPanelVariant = {
  id: string;
  label: string;
  /** Renders the variant's body. Kept lazy so inactive variants cost nothing. */
  render: () => ReactNode;
};

type Props = {
  variants: RightPanelVariant[];
  activeId: string;
  onChange: (id: string) => void;
};

/** The panel-header control + the active variant's body. */
export function RightPanelSwitcher({ variants, activeId, onChange }: Props) {
  const active = variants.find((v) => v.id === activeId) ?? variants[0];
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <SegmentedControl
        size="sm"
        fullWidth
        aria-label="Panel view"
        value={active.id}
        onValueChange={onChange}
        items={variants.map((v) => ({ value: v.id, label: v.label }))}
      />
      <div className="min-h-0 flex-1">{active.render()}</div>
    </div>
  );
}
