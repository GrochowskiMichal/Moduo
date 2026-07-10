// Email preferences — the `user_preferences.email` cloud domain (EM-10).
//
// Carries the smart-inbox per-sender section overrides (user-scoped, cloud-synced
// via prefs-sync.ts, owner-aware last-write-wins). The shape + sanitizer live here
// so the sync wiring is pure transport; a localStorage mirror gives instant first
// paint and single-device persistence when the cloud column isn't applied yet.

import { EMAIL_SECTIONS, type EmailSection } from "./classify";

function readStored<T>(key: string, sanitize: (raw: unknown) => T, fallback: () => T): T {
  if (typeof window === "undefined") return fallback();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback();
    return sanitize(JSON.parse(raw));
  } catch {
    return fallback();
  }
}

function writeStored(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or storage disabled — non-fatal */
  }
}

export type EmailPrefs = {
  /** Smart-inbox override: lowercased sender address → forced section. Wins over
   * the deterministic rules; teaches the inbox (brief §5). */
  senderOverrides: Record<string, EmailSection>;
  /** Lowercased sender addresses whose remote images always load (DF-6 —
   * remote content is blocked by default in the reader). */
  imageAllowedSenders: string[];
};

export const DEFAULT_EMAIL_PREFS: EmailPrefs = {
  senderOverrides: {},
  imageAllowedSenders: [],
};

const SECTION_SET = new Set<string>(EMAIL_SECTIONS);

/** Coerce any stored/synced value into a valid prefs object (round-trips). */
export function sanitizeEmailPrefs(raw: unknown): EmailPrefs {
  if (!raw || typeof raw !== "object") {
    return { senderOverrides: {}, imageAllowedSenders: [] };
  }
  const o = raw as Record<string, unknown>;
  const senderOverrides: Record<string, EmailSection> = {};
  if (o.senderOverrides && typeof o.senderOverrides === "object") {
    for (const [addr, section] of Object.entries(o.senderOverrides as Record<string, unknown>)) {
      const key = addr.trim().toLowerCase();
      if (key && typeof section === "string" && SECTION_SET.has(section)) {
        senderOverrides[key] = section as EmailSection;
      }
    }
  }
  const imageAllowedSenders: string[] = [];
  if (Array.isArray(o.imageAllowedSenders)) {
    const seen = new Set<string>();
    for (const entry of o.imageAllowedSenders) {
      if (typeof entry !== "string") continue;
      const key = entry.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        imageAllowedSenders.push(key);
      }
    }
  }
  return { senderOverrides, imageAllowedSenders };
}

function prefsKey(userId: string): string {
  return `moduo:email:prefs:${userId}`;
}

export function readEmailPrefs(userId: string): EmailPrefs {
  return readStored(prefsKey(userId), sanitizeEmailPrefs, () => ({
    ...DEFAULT_EMAIL_PREFS,
    senderOverrides: {},
    imageAllowedSenders: [],
  }));
}

export function writeEmailPrefs(userId: string, prefs: EmailPrefs): void {
  writeStored(prefsKey(userId), sanitizeEmailPrefs(prefs));
}
