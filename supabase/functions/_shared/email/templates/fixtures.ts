/**
 * Example data for every built template, using the brand's example cast
 * (brand brief §11: Tom Becker, Anna Carter, Northwind Studio). Feeds the unit
 * tests and the Storybook email gallery.
 */

import type { BuiltEmailKind, EmailTemplateData } from "./index.ts";

export const EMAIL_FIXTURES: { [K in BuiltEmailKind]: EmailTemplateData[K] } = {
  auth_code: { code: "482913", email: "tom@becker.studio" },
  ops_alert: {
    reason: "failures",
    windowMinutes: 10,
    authCodeFailed: 1,
    otherFailed: 2,
    errors: [
      { error: "resend_http_500", count: 2 },
      { error: "timeout", count: 1 },
    ],
    detectedAt: "2026-10-16T12:05:00Z",
  },
};

/** A label for each kind in the gallery, matching the IDs in the ratified email set. */
export const EMAIL_LABELS: Record<BuiltEmailKind, string> = {
  auth_code: "A1 · Sign-in code",
  ops_alert: "Ops alert (internal)",
};
