import { SettingsSectionShell } from "./section-shell";

export function PreferencesSection() {
  return (
    <SettingsSectionShell
      title="Preferences"
      description="Default views, sounds, and other day-to-day behaviour."
    >
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Preferences land alongside the per-feature briefs.
      </div>
    </SettingsSectionShell>
  );
}
