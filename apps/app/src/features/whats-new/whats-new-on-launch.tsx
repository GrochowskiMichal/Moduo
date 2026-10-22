// After an update (desktop relaunch or web reload), "Updated to X · See what's
// new" once (REL-4, AC8). The toast only offers the dialog; nothing opens by
// itself over someone's work. Mounts the one What's new dialog too.
//
// The last version told about lives in the synced preferences (so it's once
// per person, on any device), with their localStorage mirror as the fallback
// offline or signed out of sync. It's decided once this session's preferences
// have been read, so a new device never shows a toast the person already saw.

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  currentPreferences,
  type Preferences,
  updatePreferences,
  usePreferencesReady,
} from "../../lib/preferences";
import { useAuth } from "../../providers/auth-provider";
import { APP_VERSION } from "../settings/about";
import { findRelease, type Release, RELEASES, whatsNewDecision } from "./releases";
import { WhatsNewDialog } from "./whats-new-dialog";
import { openWhatsNew } from "./whats-new-store";

const TOAST_ID = "moduo-whats-new";
/** Long enough to notice after a relaunch; it closes by itself after that. */
const TOAST_MS = 12_000;

/** The earliest moment these preferences say the person was using Moduo. */
export function knownSince(prefs: Preferences): string | null {
  const o = prefs.tasksOnboarding;
  const stamps = [
    o.roleAt,
    o.welcomeSeenAt,
    ...Object.values(o.seeded),
    ...Object.values(o.viewsSeeded),
  ]
    .filter((s): s is string => !!s)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return stamps[0] ?? null;
}

export function WhatsNewOnLaunch({
  version = APP_VERSION,
  releases = RELEASES,
}: {
  version?: string;
  releases?: Release[];
}) {
  const { userId, runtime } = useAuth();
  const prefsReady = usePreferencesReady(userId);
  const decidedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || decidedRef.current === userId) return;
    const prefs = currentPreferences();
    const release = findRelease(version, releases);
    const decision = whatsNewDecision({
      running: version,
      lastSeen: prefs.lastSeenVersion,
      prefsReady,
      release,
      knownSince: knownSince(prefs),
    });
    if (decision === "wait") return;
    decidedRef.current = userId;
    if (decision === "none") return;
    // Seen the moment it shows, so a reload doesn't bring it back.
    updatePreferences({ lastSeenVersion: version });
    if (decision !== "show") return;
    toast(`Updated to ${version}`, {
      id: TOAST_ID,
      duration: TOAST_MS,
      action: { label: "See what's new", onClick: () => openWhatsNew({ version }) },
    });
  }, [userId, prefsReady, version, releases]);

  return (
    <WhatsNewDialog
      releases={releases}
      onOpenExternal={runtime ? (href) => void runtime.window.openExternalUrl(href) : undefined}
    />
  );
}
