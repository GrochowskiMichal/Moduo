import type { ReactNode } from "react";

import { Eyebrow } from "../../../components/ui/eyebrow";
import { useAppearance } from "../../../lib/appearance";
import { AccentPicker } from "../appearance/accent-picker";
import { DensityPicker } from "../appearance/density-picker";
import { FontPicker } from "../appearance/font-picker";
import { RadiusPicker } from "../appearance/radius-picker";
import { ShadePicker } from "../appearance/shade-picker";
import { TabsPicker } from "../appearance/tabs-picker";
import { ThemePicker } from "../appearance/theme-picker";

import { SettingsSectionShell } from "./section-shell";

/** A labelled cluster of pickers (Color / Type / Layout). The eyebrow sits
 *  above the card so each picker row keeps its `first:pt-0` divider rhythm. */
function AppearanceGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="px-1">{label}</Eyebrow>
      <section className="flex flex-col rounded-lg border border-border bg-card px-6 pb-6 pt-5">
        {children}
      </section>
    </div>
  );
}

// One typeface drives the whole app (font picker below); hierarchy is weight/
// size, not a display/body split. The text-size picker stays retired — density
// remains the size axis. Synced across devices: theme/shade/accent/radius/font.
// Per-device (localStorage): density + module navigation — tagged "This device".
export function AppearanceSection() {
  const { appearance, setTheme, setShade, setAccent, setDensity, setRadius, setFont, setTabs } =
    useAppearance();

  return (
    <SettingsSectionShell
      title="Appearance"
      description="Theme, type, and layout. Changes preview live against the app behind this modal."
    >
      <p className="text-xs text-muted-foreground">
        Most appearance settings follow you across your devices. Density and module navigation are
        set per device.
      </p>

      <AppearanceGroup label="Color">
        <ThemePicker value={appearance.theme} onChange={setTheme} />
        <ShadePicker value={appearance.shade} onChange={setShade} />
        <AccentPicker value={appearance.accent} onChange={setAccent} />
      </AppearanceGroup>

      <AppearanceGroup label="Type">
        <FontPicker value={appearance.font} onChange={setFont} />
      </AppearanceGroup>

      <AppearanceGroup label="Layout">
        <DensityPicker value={appearance.density} onChange={setDensity} />
        <RadiusPicker value={appearance.radius} onChange={setRadius} />
        <TabsPicker value={appearance.tabs} onChange={setTabs} />
      </AppearanceGroup>
    </SettingsSectionShell>
  );
}
