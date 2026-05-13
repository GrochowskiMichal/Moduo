import { useAppearance } from "../../../lib/appearance";
import { AccentPicker } from "../appearance/accent-picker";
import { DensityPicker } from "../appearance/density-picker";
import { FontPicker } from "../appearance/font-picker";
import { AppearanceLivePreview } from "../appearance/live-preview";
import { RadiusPicker } from "../appearance/radius-picker";
import { TextSizePicker } from "../appearance/text-size-picker";
import { ThemePicker } from "../appearance/theme-picker";

import { SettingsSectionShell } from "./section-shell";

export function AppearanceSection() {
  const {
    appearance,
    setTheme,
    setAccent,
    setDensity,
    setRadius,
    setFontDisplay,
    setFontBody,
    setTextSize,
  } = useAppearance();

  return (
    <SettingsSectionShell
      title="Appearance"
      description="Theme, accent, density, radius, and typography. Changes apply instantly."
      className="max-w-5xl"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="flex flex-col rounded-lg border border-border bg-card px-6 pb-6 pt-5">
          <ThemePicker value={appearance.theme} onChange={setTheme} />
          <AccentPicker value={appearance.accent} onChange={setAccent} />
          <DensityPicker value={appearance.density} onChange={setDensity} />
          <RadiusPicker value={appearance.radius} onChange={setRadius} />
          <FontPicker role="display" value={appearance.fontDisplay} onChange={setFontDisplay} />
          <FontPicker role="body" value={appearance.fontBody} onChange={setFontBody} />
          <TextSizePicker value={appearance.textSize} onChange={setTextSize} />
        </section>
        <div className="lg:sticky lg:top-2 lg:self-start">
          <AppearanceLivePreview />
        </div>
      </div>
    </SettingsSectionShell>
  );
}
