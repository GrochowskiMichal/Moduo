import { SettingsSectionShell } from "./section-shell";

export function AdvancedSection() {
  return (
    <SettingsSectionShell
      title="Advanced"
      description="Storage, diagnostics, and developer tools."
    >
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Advanced controls arrive with the storage + diagnostics brief.
      </div>
    </SettingsSectionShell>
  );
}
