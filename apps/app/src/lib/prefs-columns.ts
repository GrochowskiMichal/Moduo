// Deploy-gap column helpers for the shared `user_preferences` row (used by
// runtime.web's preferences.get/set). Extracted as pure logic so the two-optional-
// column attribution can be unit-tested without importing the whole web runtime.
//
// The optional prefs domains (email = EM-10, preferences = DF-19f) may not be
// applied yet on a given environment (a teammate pulled a merged branch before the
// migration ran, or a rollout is mid-flight). The base columns are always present;
// each optional domain is appended to the select only while believed available, and
// the first missing-column error for it flips it off until reload (auto-heals once
// the migration deploys). Keeps the hot appearance/focus/calendar read from
// breaking pre-migration.

export const PREFS_COLS_BASE =
  "appearance, appearance_updated_at, focus, focus_updated_at, calendar, calendar_updated_at";

export const OPTIONAL_PREFS_COLS = {
  email: "email, email_updated_at",
  preferences: "preferences, preferences_updated_at",
} as const;

export type OptionalPrefsDomain = keyof typeof OPTIONAL_PREFS_COLS;

// Mutable per-process availability flags — a missing-column error flips one off
// until reload. A shared singleton: runtime.web mutates it; tests reset it.
export const optionalPrefsAvailable: Record<OptionalPrefsDomain, boolean> = {
  email: true,
  preferences: true,
};

// A literal for the typed client's `.select()` parser — the runtime column set is
// dynamic (deploy gap), so callers cast the built string to this shape.
export const PREFS_COLS_FULL =
  `${PREFS_COLS_BASE}, ${OPTIONAL_PREFS_COLS.email}, ${OPTIONAL_PREFS_COLS.preferences}` as const;

/** The select column list for the currently-believed-available domains. */
export function prefsSelectCols(): typeof PREFS_COLS_FULL {
  const parts: string[] = [PREFS_COLS_BASE];
  if (optionalPrefsAvailable.email) parts.push(OPTIONAL_PREFS_COLS.email);
  if (optionalPrefsAvailable.preferences) parts.push(OPTIONAL_PREFS_COLS.preferences);
  return parts.join(", ") as typeof PREFS_COLS_FULL;
}

// Which optional domain (if any) a missing-column error refers to. PostgREST names
// the column in the message; the 42703 code alone is ambiguous with two optional
// columns, so match by name first and fall back to the newest still-enabled domain.
// The `\b` before each name avoids a false match inside the table name
// `user_preferences` (the `_` there is a word char, so no boundary before it).
export function missingOptionalPrefsDomain(
  err: { code?: string; message?: string } | null,
): OptionalPrefsDomain | null {
  if (!err) return null;
  const msg = err.message ?? "";
  if (optionalPrefsAvailable.preferences && /\bpreferences\b.*does not exist/i.test(msg)) {
    return "preferences";
  }
  if (optionalPrefsAvailable.email && /\bemail\b.*does not exist/i.test(msg)) return "email";
  if (err.code === "42703") {
    if (optionalPrefsAvailable.preferences) return "preferences";
    if (optionalPrefsAvailable.email) return "email";
  }
  return null;
}
