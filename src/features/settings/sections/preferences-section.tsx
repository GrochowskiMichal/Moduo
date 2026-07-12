import type { ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import {
  usePreferences,
  type LandingView,
  type MotionPref,
} from "../../../lib/preferences";

import { SettingsSectionShell } from "./section-shell";

const LANDING_OPTIONS: ReadonlyArray<{ value: LandingView; label: string }> = [
  { value: "home", label: "Home" },
  { value: "tasks", label: "Tasks" },
  { value: "calendar", label: "Calendar" },
  { value: "notes", label: "Notes" },
  { value: "contacts", label: "Contacts" },
  { value: "email", label: "Email" },
  { value: "last", label: "Last used" },
];

const MOTION_OPTIONS: ReadonlyArray<{ value: MotionPref; label: string }> = [
  { value: "system", label: "Match device" },
  { value: "reduced", label: "Reduced" },
  { value: "full", label: "Full" },
];

/** Day-to-day behaviour: what opens on launch, startup behaviour, and sounds &
 *  motion. Persisted to the synced `preferences` domain (usePreferences).
 *  Per-type notification toggles land here once DF-9 ships their suppression. */
export function PreferencesSection() {
  const { preferences, setPreferences } = usePreferences();

  return (
    <SettingsSectionShell
      title="Preferences"
      description="How Moduo opens and behaves day to day. These settings follow you across your devices."
    >
      <PrefGroup label="Default landing view">
        <PrefRow
          title="Open on launch"
          description="Which surface Moduo shows when you start it. A direct link always wins."
        >
          <Select
            value={preferences.landingView}
            onValueChange={(v) => setPreferences({ landingView: v as LandingView })}
          >
            <SelectTrigger className="w-44" aria-label="Default landing view">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANDING_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PrefRow>
      </PrefGroup>

      <PrefGroup label="Startup">
        <PrefRow
          title="Reopen last workspace"
          description="Start in the workspace you last had open, instead of your first one."
        >
          <Switch
            checked={preferences.reopenLastWorkspace}
            onCheckedChange={(v) => setPreferences({ reopenLastWorkspace: v })}
            aria-label="Reopen last workspace on launch"
          />
        </PrefRow>
      </PrefGroup>

      <PrefGroup label="Sounds & motion">
        <PrefRow
          title="Sound effects"
          description="Play sounds like the Focus interval chime. Turning this off mutes them all."
        >
          <Switch
            checked={preferences.soundEnabled}
            onCheckedChange={(v) => setPreferences({ soundEnabled: v })}
            aria-label="Sound effects"
          />
        </PrefRow>
        <PrefRow
          title="Motion"
          description="Match your device's reduce-motion setting, or override it here."
        >
          <Select
            value={preferences.motion}
            onValueChange={(v) => setPreferences({ motion: v as MotionPref })}
          >
            <SelectTrigger className="w-44" aria-label="Motion">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOTION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PrefRow>
      </PrefGroup>
    </SettingsSectionShell>
  );
}

/** A labelled cluster (eyebrow above a card), mirroring the Appearance section. */
function PrefGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <section className="flex flex-col rounded-lg border border-border bg-card px-6 py-2">
        {children}
      </section>
    </div>
  );
}

function PrefRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 first:pt-2 last:border-b-0 last:pb-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
