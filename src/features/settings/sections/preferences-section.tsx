import type { ReactNode } from "react";

import { Eyebrow } from "../../../components/ui/eyebrow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import {
  isAnalyticsAvailable,
  setAnalyticsConsent,
  useAnalyticsConsent,
} from "../../../lib/analytics";
import {
  type LandingView,
  type MotionPref,
  type NotificationType,
  usePreferences,
} from "../../../lib/preferences";
import { isTauriRuntime } from "../../../lib/runtime";
import { useAuth } from "../../../providers/auth-provider";

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

/** The quiet-set notification toggles, in bell-priority order. Each governs one
 *  `NotificationType`; muting is a read-side filter over the feed (DF-19f-notif). */
const NOTIFICATION_ROWS: ReadonlyArray<{
  type: NotificationType;
  title: string;
  description: string;
}> = [
  { type: "mention", title: "Mentions", description: "When someone @mentions you in a comment." },
  {
    type: "assigned",
    title: "Assigned to you",
    description: "When someone else assigns a task to you.",
  },
  {
    type: "completed",
    title: "Completed by someone else",
    description: "When a teammate completes a task you created.",
  },
  {
    type: "dueFollowUp",
    title: "Due & follow-up",
    description: "Snoozed and follow-up items that come due.",
  },
  {
    type: "unblocked",
    title: "Task unblocked",
    description: "When the last thing blocking a task is finished.",
  },
  {
    type: "storage",
    title: "Storage almost full",
    description: "When files take your workspaces past 80% and 95% of your storage. Owners only.",
  },
];

/** Day-to-day behaviour: per-type notification mutes, what opens on launch,
 *  startup behaviour, and sounds & motion — all persisted to the synced
 *  `preferences` domain (usePreferences) — plus the analytics opt-in, which
 *  stays on this device (see AnalyticsConsentGroup). */
export function PreferencesSection() {
  const { preferences, setPreferences } = usePreferences();

  return (
    <SettingsSectionShell
      title="Preferences"
      description="How Moduo opens and behaves day to day. These settings follow you across your devices."
    >
      <PrefGroup
        label="Notifications"
        description="Which alerts reach your bell. Muting hides a type — nothing is deleted, and turning it back on brings it back."
      >
        {NOTIFICATION_ROWS.map((row) => (
          <PrefRow key={row.type} title={row.title} description={row.description}>
            <Switch
              checked={preferences.notifications[row.type]}
              onCheckedChange={(v) =>
                setPreferences({ notifications: { ...preferences.notifications, [row.type]: v } })
              }
              aria-label={`${row.title} notifications`}
            />
          </PrefRow>
        ))}
        {/* DF-21e — an opt-in surfacing, not a mute (default OFF). Overdue work
            otherwise lives in Tasks/Home; this adds a quiet, passive list to the
            bell. Never inflates the badge; clears when a task resolves. */}
        <PrefRow
          title="Show overdue tasks"
          description="Add a quiet list of tasks whose scheduled time has passed to your bell. Off by default — it never adds to the badge."
        >
          <Switch
            checked={preferences.notifications.overdueTasks}
            onCheckedChange={(v) =>
              setPreferences({ notifications: { ...preferences.notifications, overdueTasks: v } })
            }
            aria-label="Show overdue tasks in notifications"
          />
        </PrefRow>
      </PrefGroup>

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
        {isTauriRuntime() ? (
          <PrefRow
            title="Confirm before quitting"
            description="Ask for confirmation before quitting the app, whether you press ⌘Q or close the window."
          >
            <Switch
              checked={preferences.confirmBeforeQuit}
              onCheckedChange={(v) => setPreferences({ confirmBeforeQuit: v })}
              aria-label="Confirm before quitting"
            />
          </PrefRow>
        ) : null}
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

      <AnalyticsConsentGroup />
    </SettingsSectionShell>
  );
}

/** The per-person analytics opt-in (lib/analytics.ts). Only exists in builds that ship a
 *  PostHog key — none do yet — and is off until the person turns it on. Unlike the rest
 *  of this section it doesn't sync: consent is kept per account on each device. */
function AnalyticsConsentGroup() {
  const { userId } = useAuth();
  const consent = useAnalyticsConsent(userId);
  if (!userId || !isAnalyticsAvailable()) return null;
  return (
    <PrefGroup label="Privacy" description="Saved on this device, for your account only.">
      <PrefRow
        title="Share usage analytics"
        description="Send events like opening the app, with basic device and browser details, to PostHog so we can improve Moduo. They carry your account ID, never your email or anything you write. Turning this off also deletes what your account has sent so far, from every device."
      >
        <Switch
          checked={consent === "granted"}
          onCheckedChange={(on) => void setAnalyticsConsent(userId, on ? "granted" : "denied")}
          aria-label="Share usage analytics"
        />
      </PrefRow>
    </PrefGroup>
  );
}

/** A labelled cluster (eyebrow above a card), mirroring the Appearance section.
 *  An optional description sits under the eyebrow for groups that need a one-line
 *  explainer (e.g. Notifications). */
function PrefGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <Eyebrow>{label}</Eyebrow>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
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
