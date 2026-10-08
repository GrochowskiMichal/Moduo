// Contact status — a renamable flat label, never a pipeline (specs/contacts.md
// AC3, decision 5). The default set is Lead / Active / Dormant / Archived; the
// labels are renamable in settings, but there are deliberately NO stages, no
// required transitions, and no automation API in this module. Any status — a
// default or a renamed/custom one — is just a string; the only operations are
// "normalize an input" and "how do I render it" (color + label, AC12).

import type { ContactStatus } from "./model";

/** Status tone → a semantic token role (color is never the only signal: tone
 * pairs with the label, per DESIGN_RULES R-color). */
export type ContactStatusTone = "info" | "success" | "warning" | "muted";

export type ContactStatusMeta = {
  /** Stable lowercase id (what's stored). */
  id: string;
  /** Sentence-case display label (renamable in settings). */
  label: string;
  tone: ContactStatusTone;
};

/** The fallback status for a new/empty contact — none (status is optional; v2). */
export const DEFAULT_CONTACT_STATUS: ContactStatus = "";

/**
 * The default, renamable status set. A flat list — the order is presentational,
 * NOT a funnel; nothing prevents going from `archived` straight to `lead`.
 */
export const DEFAULT_CONTACT_STATUSES: ContactStatusMeta[] = [
  { id: "lead", label: "Lead", tone: "info" },
  { id: "active", label: "Active", tone: "success" },
  { id: "dormant", label: "Dormant", tone: "warning" },
  { id: "archived", label: "Archived", tone: "muted" },
];

const DEFAULTS_BY_ID: Record<string, ContactStatusMeta> = Object.fromEntries(
  DEFAULT_CONTACT_STATUSES.map((s) => [s.id, s]),
);

/** Title-case a custom/renamed status id for display ("vip lead" → "Vip lead"). */
function humanize(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Normalize an arbitrary status input to a stored value. Accepts ANY non-empty
 * string (renamed/custom labels are first-class — there is no closed set to
 * reject against), trimming + lowercasing for a stable id. Empty / non-string
 * input falls back to {@link DEFAULT_CONTACT_STATUS}.
 */
export function normalizeContactStatus(value: unknown): ContactStatus {
  if (typeof value !== "string") return DEFAULT_CONTACT_STATUS;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? DEFAULT_CONTACT_STATUS : trimmed;
}

/**
 * Render metadata for a status — a label AND a tone, so the UI never signals
 * status by color alone. A default status uses its set entry; a renamed/custom
 * status passes through with a humanized label and a neutral tone (never
 * rejected — that's what "renamable" means).
 */
export function contactStatusMeta(value: unknown): ContactStatusMeta {
  const id = normalizeContactStatus(value);
  if (id === "") return { id: "", label: "No status", tone: "muted" };
  return DEFAULTS_BY_ID[id] ?? { id, label: humanize(id), tone: "muted" };
}
