import { SettingsSectionShell } from "./section-shell";

export function AppearanceSection() {
  return (
    <SettingsSectionShell
      title="Appearance"
      description="Theme, accent, density, radius, and typography. Changes apply instantly."
    >
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Appearance pickers land in the next commit.
      </div>
    </SettingsSectionShell>
  );
}
