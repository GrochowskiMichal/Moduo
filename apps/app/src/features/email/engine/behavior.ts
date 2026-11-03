// Mail behavior settings the app-wide provider reads (spec §Notifications and
// badges, A2/A3/S2). Per device until MR-13's Settings → Mail lands; a reader
// that can't parse the stored value gets the defaults.

export const MAIL_BADGE_MODES = ["personal", "all", "off"] as const;
export type MailBadgeMode = (typeof MAIL_BADGE_MODES)[number];

export type MailBehavior = {
  /** What the nav and Dock badge count (A3: Personal by default). */
  badge: MailBadgeMode;
  /** Notify for new Personal mail (A2: off by default). */
  notifyPersonal: boolean;
  /** Priority people's mail always notifies (X2). */
  notifyPriority: boolean;
};

export const DEFAULT_MAIL_BEHAVIOR: MailBehavior = {
  badge: "personal",
  notifyPersonal: false,
  notifyPriority: true,
};

const KEY = "moduo:mail:behavior";

export function sanitizeMailBehavior(raw: unknown): MailBehavior {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    badge: MAIL_BADGE_MODES.includes(r.badge as MailBadgeMode)
      ? (r.badge as MailBadgeMode)
      : DEFAULT_MAIL_BEHAVIOR.badge,
    notifyPersonal:
      typeof r.notifyPersonal === "boolean"
        ? r.notifyPersonal
        : DEFAULT_MAIL_BEHAVIOR.notifyPersonal,
    notifyPriority:
      typeof r.notifyPriority === "boolean"
        ? r.notifyPriority
        : DEFAULT_MAIL_BEHAVIOR.notifyPriority,
  };
}

export function readMailBehavior(): MailBehavior {
  try {
    const raw = window.localStorage.getItem(KEY);
    return sanitizeMailBehavior(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_MAIL_BEHAVIOR };
  }
}

export function writeMailBehavior(behavior: MailBehavior): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sanitizeMailBehavior(behavior)));
  } catch {
    /* storage disabled: the setting lasts this session only */
  }
}

/** Until the Rust `mail_*` commands land (MR-3/MR-5) the desktop engine is
 *  opt-in per device: `localStorage["moduo:mail:engine"] = "1"`. */
export function mailEngineEnabled(): boolean {
  try {
    return window.localStorage.getItem("moduo:mail:engine") === "1";
  } catch {
    return false;
  }
}
