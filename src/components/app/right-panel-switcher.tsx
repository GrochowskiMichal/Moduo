// The right-panel variant switcher — the Moduo-wide IA principle's shared
// surface (DESIGN_BRIEF §5, decisions.md): the right panel is user-switchable
// with per-module hand-picked variants, never a hardcoded single purpose.
// Built inside Calendar (its first adopter) and SHAPED FOR EXTRACTION; lifted
// to the app shell here when Notes (NO-7) became the second adopter — types +
// component unchanged, Calendar now imports from this location.

import type { ReactNode } from "react";

import { SegmentedControl } from "../ui/segmented-control";

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

/**
 * The panel-header control + the active variant's body. With one variant there
 * is nothing to switch, so only its body renders (a module lists its variants
 * here from the start, so adding a second one brings the switcher back).
 */
export function RightPanelSwitcher({ variants, activeId, onChange }: Props) {
  const active = variants.find((v) => v.id === activeId) ?? variants[0];
  if (variants.length <= 1) {
    return <div className="flex h-full min-h-0 flex-col">{active?.render()}</div>;
  }
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
