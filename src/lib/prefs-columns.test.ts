import { beforeEach, describe, expect, it } from "vitest";

import {
  PREFS_COLS_BASE,
  missingOptionalPrefsDomain,
  optionalPrefsAvailable,
  prefsSelectCols,
} from "./prefs-columns";

// The availability flags are a shared singleton (runtime.web mutates them across a
// process); reset before each case so tests don't leak state into one another.
beforeEach(() => {
  optionalPrefsAvailable.email = true;
  optionalPrefsAvailable.preferences = true;
});

describe("prefsSelectCols", () => {
  it("includes both optional domains when available", () => {
    const cols = prefsSelectCols();
    expect(cols.startsWith(PREFS_COLS_BASE)).toBe(true);
    expect(cols).toContain("email, email_updated_at");
    expect(cols).toContain("preferences, preferences_updated_at");
  });

  it("drops an unavailable optional domain but keeps the base + the other", () => {
    optionalPrefsAvailable.preferences = false;
    const cols = prefsSelectCols();
    expect(cols.startsWith(PREFS_COLS_BASE)).toBe(true);
    expect(cols).toContain("email, email_updated_at");
    expect(cols).not.toContain("preferences");
  });

  it("falls back to base-only when both optional domains are off", () => {
    optionalPrefsAvailable.email = false;
    optionalPrefsAvailable.preferences = false;
    expect(prefsSelectCols()).toBe(PREFS_COLS_BASE);
  });
});

describe("missingOptionalPrefsDomain", () => {
  it("attributes a preferences-column error to preferences", () => {
    expect(
      missingOptionalPrefsDomain({
        code: "42703",
        message: "column user_preferences.preferences does not exist",
      }),
    ).toBe("preferences");
  });

  it("attributes an email-column error to email", () => {
    expect(
      missingOptionalPrefsDomain({
        code: "42703",
        message: "column user_preferences.email does not exist",
      }),
    ).toBe("email");
  });

  it("does NOT false-match the table name user_preferences (whole-table-missing error)", () => {
    expect(
      missingOptionalPrefsDomain({
        code: "42P01",
        message: 'relation "user_preferences" does not exist',
      }),
    ).toBeNull();
  });

  it("falls back to the newest still-enabled domain on a bare 42703 (no column named)", () => {
    expect(missingOptionalPrefsDomain({ code: "42703", message: "" })).toBe("preferences");
    optionalPrefsAvailable.preferences = false;
    expect(missingOptionalPrefsDomain({ code: "42703", message: "" })).toBe("email");
  });

  it("attributes correctly across the both-missing retry sequence", () => {
    // The select lists email before preferences, so Postgres names email first.
    expect(
      missingOptionalPrefsDomain({
        code: "42703",
        message: "column user_preferences.email does not exist",
      }),
    ).toBe("email");
    optionalPrefsAvailable.email = false; // caller drops it, then retries base+preferences
    expect(
      missingOptionalPrefsDomain({
        code: "42703",
        message: "column user_preferences.preferences does not exist",
      }),
    ).toBe("preferences");
  });

  it("returns null for a non-column error (so the caller re-throws)", () => {
    expect(missingOptionalPrefsDomain({ code: "42501", message: "permission denied" })).toBeNull();
    expect(missingOptionalPrefsDomain(null)).toBeNull();
    expect(missingOptionalPrefsDomain({})).toBeNull();
  });
});
