import { useAppearance } from "../../../lib/appearance";
import { AccentPicker } from "../appearance/accent-picker";
import { DensityPicker } from "../appearance/density-picker";
import { RadiusPicker } from "../appearance/radius-picker";
import { ThemePicker } from "../appearance/theme-picker";

import { SettingsSectionShell } from "./section-shell";

export function AppearanceSection() {
  const {
    appearance,
    setTheme,
    setAccent,
    setDensity,
    setRadius,
  } = useAppearance();

  return (
    <SettingsSectionShell
      title="Appearance"
      description="Theme, accent, density, radius, and typography. Changes apply instantly."
    >
      <section className="flex flex-col rounded-lg border border-border bg-card px-6 pb-6 pt-5">
        <ThemePicker value={appearance.theme} onChange={setTheme} />
        <AccentPicker value={appearance.accent} onChange={setAccent} />
        <DensityPicker value={appearance.density} onChange={setDensity} />
        <RadiusPicker value={appearance.radius} onChange={setRadius} />
      </section>
    </SettingsSectionShell>
  );
}
