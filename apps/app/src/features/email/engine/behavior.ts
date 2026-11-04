// Mail behavior settings (spec §Settings → Mail, Behavior). Settings → Mail
// (MR-15) syncs them in `user_preferences.email.behavior` and mirrors them
// here, the copy the app-wide provider reads at boot; a reader that can't
// parse the stored value gets the defaults.

import { MAIL_BLOCK_DESTINATIONS, type MailBlockDestination } from "@contracts/mail";

export const MAIL_BADGE_MODES = ["personal", "all", "off"] as const;
export type MailBadgeMode = (typeof MAIL_BADGE_MODES)[number];
export const MAIL_REMOTE_IMAGES = ["block", "contacts", "always"] as const;
export type MailRemoteImages = (typeof MAIL_REMOTE_IMAGES)[number];
export const MAIL_UNDO_SEND_SECONDS = [5, 10, 20, 30] as const;
export type MailUndoSendSeconds = (typeof MAIL_UNDO_SEND_SECONDS)[number];
export const MAIL_DENSITIES = ["comfortable", "compact"] as const;
export type MailDensity = (typeof MAIL_DENSITIES)[number];

export type MailBehavior = {
  /** What the nav and Dock badge count (A3: Personal by default). */
  badge: MailBadgeMode;
  /** Notify for new Personal mail (A2: off by default). */
  notifyPersonal: boolean;
  /** Priority people's mail always notifies (X2). */
  notifyPriority: boolean;
  /** Remote images in the reader (S4 / D25: blocked by default). */
  remoteImages: MailRemoteImages;
  /** Strip tracking pixels (X7, on). */
  trackerBlocking: boolean;
  /** Spell check in compose (X18, on). */
  spellCheck: boolean;
  /** Undo-send window (E42 / X22, default 10 s). */
  undoSendSeconds: MailUndoSendSeconds;
  /** Replying from the inbox marks the thread Done (E48, on). */
  doneOnSend: boolean;
  /** List density (X24). */
  density: MailDensity;
  /** Preview lines per row (X24). */
  previewLines: 1 | 2;
  /** Show shortcut hints (X21, on). */
  shortcutHints: boolean;
  /** Sender logos (X17, on). */
  senderLogos: boolean;
  /** The Screener (X1, off by default). */
  screener: boolean;
  /** Where a blocked sender's new mail goes (B18, Trash by default). */
  blockDestination: MailBlockDestination;
  /** The chosen folder when `blockDestination` is "folder". */
  blockFolder: string | null;
};

export const DEFAULT_MAIL_BEHAVIOR: MailBehavior = {
  badge: "personal",
  notifyPersonal: false,
  notifyPriority: true,
  remoteImages: "block",
  trackerBlocking: true,
  spellCheck: true,
  undoSendSeconds: 10,
  doneOnSend: true,
  density: "comfortable",
  previewLines: 1,
  shortcutHints: true,
  senderLogos: true,
  screener: false,
  blockDestination: "trash",
  blockFolder: null,
};

const KEY = "moduo:mail:behavior";

function pick<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeMailBehavior(raw: unknown): MailBehavior {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_MAIL_BEHAVIOR;
  return {
    badge: pick(MAIL_BADGE_MODES, r.badge, d.badge),
    notifyPersonal: bool(r.notifyPersonal, d.notifyPersonal),
    notifyPriority: bool(r.notifyPriority, d.notifyPriority),
    remoteImages: pick(MAIL_REMOTE_IMAGES, r.remoteImages, d.remoteImages),
    trackerBlocking: bool(r.trackerBlocking, d.trackerBlocking),
    spellCheck: bool(r.spellCheck, d.spellCheck),
    undoSendSeconds: pick(MAIL_UNDO_SEND_SECONDS, r.undoSendSeconds, d.undoSendSeconds),
    doneOnSend: bool(r.doneOnSend, d.doneOnSend),
    density: pick(MAIL_DENSITIES, r.density, d.density),
    previewLines: pick([1, 2] as const, r.previewLines, d.previewLines),
    shortcutHints: bool(r.shortcutHints, d.shortcutHints),
    senderLogos: bool(r.senderLogos, d.senderLogos),
    screener: bool(r.screener, d.screener),
    blockDestination: pick(MAIL_BLOCK_DESTINATIONS, r.blockDestination, d.blockDestination),
    blockFolder: typeof r.blockFolder === "string" && r.blockFolder.trim() ? r.blockFolder : null,
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

export type MailEngineMode = "on" | "off" | "fixture";

/** Which engine Mail runs on (MR-16 cutover). The rebuilt engine is the
 *  default; `localStorage["moduo:mail:engine"]` = "0" turns it off on this
 *  device, and "fixture" runs the in-memory fixture engine (lab journeys and
 *  demos; never real mail). */
export function mailEngineMode(): MailEngineMode {
  try {
    const v = window.localStorage.getItem("moduo:mail:engine");
    if (v === "0") return "off";
    if (v === "fixture") return "fixture";
    return "on";
  } catch {
    return "on";
  }
}

export function mailEngineEnabled(): boolean {
  return mailEngineMode() === "on";
}

/** The fixture size for "fixture" mode (`moduo:mail:fixture-messages`, default 100k). */
export function mailFixtureMessages(): number {
  try {
    const n = Number(window.localStorage.getItem("moduo:mail:fixture-messages"));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 200_000) : 100_000;
  } catch {
    return 100_000;
  }
}
