// Contacts module — "reconnect" selector. Wave 1, light-CRM.
//
// Surfaces people you've gone quiet on: contacts whose last touch (any logged
// interaction — link/mention/activity, fed in via `lastTouchByContactId`) is
// older than a threshold, or never recorded. PURE — no React, no side effects;
// the spine/UI feeds the map and renders the result.

import type { Contact } from "./model";

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_DAYS = 30;

/** A contact worth reaching back out to, with how stale the connection is. */
export type ReconnectItem = {
  contactId: string;
  name: string;
  /** ISO timestamp of the most recent touch, or null if never recorded. */
  lastTouchAt: string | null;
  /** Whole days since last touch; null when there is no last touch. */
  daysSince: number | null;
};

export type SelectReconnectInput = {
  contacts: Contact[];
  /** contactId → ISO last-touch timestamp (or null = never touched). */
  lastTouchByContactId: Record<string, string | null>;
  now: Date;
  /** Max items returned. Default 5. */
  limit?: number;
  /** Quiet-for threshold in days. Default 30. */
  minDays?: number;
};

/**
 * Pick the contacts you've gone quiet on, oldest-first.
 *
 * Eligibility:
 * - Last touch (from the map; missing/null = never) older than `minDays`.
 * - A null last touch is always eligible — we can't know the contact's age
 *   here, so we surface "never touched" rather than hide it. Its `daysSince`
 *   is null.
 * - `status: 'archived'` contacts are excluded outright.
 *
 * Ordering: never-touched (null) first, then by largest `daysSince` (most
 * stale) down. Ties broken by name for stable output. Returns up to `limit`.
 */
export function selectReconnect(input: SelectReconnectInput): ReconnectItem[] {
  const { contacts, lastTouchByContactId, now } = input;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const minDays = input.minDays ?? DEFAULT_MIN_DAYS;
  const nowMs = now.getTime();

  const eligible: ReconnectItem[] = [];

  for (const contact of contacts) {
    // Archived people are intentionally off the radar.
    if (contact.status === "archived") continue;

    const lastTouchAt = lastTouchByContactId[contact.id] ?? null;

    // Never touched → always eligible, daysSince unknown.
    if (lastTouchAt === null) {
      eligible.push({ contactId: contact.id, name: contact.name, lastTouchAt: null, daysSince: null });
      continue;
    }

    const touchMs = Date.parse(lastTouchAt);
    // Unparseable timestamps are treated as "never touched" (safe surfacing).
    if (Number.isNaN(touchMs)) {
      eligible.push({ contactId: contact.id, name: contact.name, lastTouchAt: null, daysSince: null });
      continue;
    }

    const daysSince = Math.floor((nowMs - touchMs) / DAY_MS);
    // Only quiet-for-longer-than-threshold contacts qualify.
    if (daysSince <= minDays) continue;

    eligible.push({ contactId: contact.id, name: contact.name, lastTouchAt, daysSince });
  }

  // Oldest-first: null daysSince (never touched) sorts before any number;
  // then larger daysSince first; name as a stable tiebreaker.
  eligible.sort((a, b) => {
    if (a.daysSince === null && b.daysSince === null) return a.name.localeCompare(b.name);
    if (a.daysSince === null) return -1;
    if (b.daysSince === null) return 1;
    if (a.daysSince !== b.daysSince) return b.daysSince - a.daysSince;
    return a.name.localeCompare(b.name);
  });

  return eligible.slice(0, limit);
}
