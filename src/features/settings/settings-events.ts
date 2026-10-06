export const SETTINGS_SECTION_IDS = [
  "appearance",
  "account",
  "billing",
  "workspace",
  "access",
  "integrations",
  "apikeys",
  "preferences",
  "focus",
  "advanced",
  "about",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

// The grouped nav (DF-19a). Every section id lives in exactly one group; the
// nav renders groups in this order, sections in each group's `ids` order.
export const SETTINGS_GROUPS = [
  { label: "Personal", ids: ["account", "billing", "appearance", "preferences", "focus"] },
  { label: "Workspace", ids: ["workspace", "access", "integrations", "apikeys"] },
  { label: "App", ids: ["advanced", "about"] },
] as const satisfies ReadonlyArray<{ label: string; ids: readonly SettingsSectionId[] }>;

export const SETTINGS_OPEN_EVENT = "moduo:settings:open";

export type SettingsOpenDetail = {
  section?: SettingsSectionId;
};

// Remembers a STICKY dispatch (the cold-load `/settings?section=…` deep link)
// so it isn't lost: during boot the settings modal mounts, unmounts, and
// remounts while the workspace loads, so both a live event and a one-shot
// buffer get wiped with the component state — instead, every modal mount
// inside the TTL re-applies the sticky dispatch and the final surviving mount
// wins (verified live 2026-07-10: three mounts in one boot). Only the
// deep-link redirect arms it (ordinary opens from the menu/palette/banner
// must never re-open a modal the user closed), and a user close clears it.
export const PENDING_OPEN_TTL_MS = 30_000;

let pendingOpen: { detail: SettingsOpenDetail; at: number } | null = null;

export function dispatchOpenSettings(
  detail: SettingsOpenDetail = {},
  opts: { sticky?: boolean } = {},
) {
  // Latest intent wins: a sticky (deep-link) dispatch arms the buffer, an
  // ordinary open (menu/palette/banner — the user is present) supersedes it.
  pendingOpen = opts.sticky ? { detail, at: Date.now() } : null;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SettingsOpenDetail>(SETTINGS_OPEN_EVENT, { detail }));
}

/** Read (without consuming) a recent sticky dispatch; the modal calls this on mount. */
export function pendingOpenSettings(now: number = Date.now()): SettingsOpenDetail | null {
  if (!pendingOpen) return null;
  if (now - pendingOpen.at > PENDING_OPEN_TTL_MS) {
    pendingOpen = null;
    return null;
  }
  return pendingOpen.detail;
}

/** The user dismissed the modal — a sticky dispatch must not re-open it. */
export function clearPendingOpenSettings() {
  pendingOpen = null;
}

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly unknown[]).includes(value);
}
