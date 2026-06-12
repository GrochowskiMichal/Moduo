import { useAppearance } from "../../../lib/appearance";
import { AccentPicker } from "../appearance/accent-picker";
import { DensityPicker } from "../appearance/density-picker";
import { FontPicker } from "../appearance/font-picker";
import { RadiusPicker } from "../appearance/radius-picker";
import { ShadePicker } from "../appearance/shade-picker";
import { TabsPicker } from "../appearance/tabs-picker";
import { TextSizePicker } from "../appearance/text-size-picker";
import { ThemePicker } from "../appearance/theme-picker";

import { SettingsSectionShell } from "./section-shell";

export function AppearanceSection() {
  const {
    appearance,
    setTheme,
    setShade,
    setAccent,
    setDensity,
    setRadius,
    setFontDisplay,
    setFontBody,
    setTextSize,
    setTabs,
  } = useAppearance();

  return (
    <SettingsSectionShell
      title="Appearance"
      description="Theme, shade, accent, density, radius, and typography. Changes preview live against the app behind this modal."
    >
      <section className="flex flex-col rounded-lg border border-border bg-card px-6 pb-6 pt-5">
        <ThemePicker value={appearance.theme} onChange={setTheme} />
        <ShadePicker value={appearance.shade} onChange={setShade} />
        <AccentPicker value={appearance.accent} onChange={setAccent} />
        <DensityPicker value={appearance.density} onChange={setDensity} />
        <RadiusPicker value={appearance.radius} onChange={setRadius} />
        <FontPicker role="display" value={appearance.fontDisplay} onChange={setFontDisplay} />
        <FontPicker role="body" value={appearance.fontBody} onChange={setFontBody} />
        <TextSizePicker value={appearance.textSize} onChange={setTextSize} />
        <TabsPicker value={appearance.tabs} onChange={setTabs} />
      </section>
    </SettingsSectionShell>
  );
}
