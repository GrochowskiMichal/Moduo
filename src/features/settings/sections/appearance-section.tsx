import { useAppearance } from "../../../lib/appearance";
import { AccentPicker } from "../appearance/accent-picker";
import { DensityPicker } from "../appearance/density-picker";
import { RadiusPicker } from "../appearance/radius-picker";
import { ShadePicker } from "../appearance/shade-picker";
import { TabsPicker } from "../appearance/tabs-picker";
import { ThemePicker } from "../appearance/theme-picker";

import { SettingsSectionShell } from "./section-shell";

// Font + text-size pickers retired (2026-06-13): one typeface (Geist) everywhere
// and one type scale, for a tighter, more controllable design system. Density
// remains the size axis.
export function AppearanceSection() {
  const { appearance, setTheme, setShade, setAccent, setDensity, setRadius, setTabs } =
    useAppearance();

  return (
    <SettingsSectionShell
      title="Appearance"
      description="Theme, shade, accent, density, and radius. Changes preview live against the app behind this modal."
    >
      <section className="flex flex-col rounded-lg border border-border bg-card px-6 pb-6 pt-5">
        <ThemePicker value={appearance.theme} onChange={setTheme} />
        <ShadePicker value={appearance.shade} onChange={setShade} />
        <AccentPicker value={appearance.accent} onChange={setAccent} />
        <DensityPicker value={appearance.density} onChange={setDensity} />
        <RadiusPicker value={appearance.radius} onChange={setRadius} />
        <TabsPicker value={appearance.tabs} onChange={setTabs} />
      </section>
    </SettingsSectionShell>
  );
}
