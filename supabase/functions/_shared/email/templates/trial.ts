/**
 * D1–D3 · Welcome and trial emails (specs/transactional-email.md TX-9a, T23).
 * Copy: `.design/transactional-email/email-set.html` (D1–D3).
 *
 * - D1 `welcome` → a new user, about 5 minutes after their first workspace is
 *   created, once ever. A note from Maciej & Mike, no button. Greets by the
 *   first word of the display name; no greeting line without one.
 * - D2 `trial_ending` → the trial owner, about 3 days before a no-card trial
 *   ends without a plan (the hourly sweep). Muted by "Trial and billing".
 * - D3 `trial_ended` → the trial owner, when a trial ends without a plan
 *   (never when it ended because the account was deleted). Muted by "Trial and
 *   billing".
 *
 * The payloads are written by SQL in snake_case (…_tx9a_welcome_trial.sql) and
 * carry every date the email prints, plus the recipient's time zone
 * (`user_preferences.time_zone`, UTC when unset), so a retry renders the same
 * body (docs/gotchas/email.md).
 *
 * The Free/Pro lines are the plan catalog's (`src/features/billing/plans.ts`),
 * kept in step by `trial.test.ts`.
 */

import { CANONICAL_APP_ORIGIN } from "../../app-origin.ts";
import { singleLine } from "../../escape.ts";
import { button, type EmailDoc, heading, lockup, muted, paragraph, signoff } from "../blocks.ts";
import { dayLong, usableTimeZone } from "../format.ts";
import type { QueuedEmail } from "../outbox.ts";
import { TEXT_LIMITS } from "../render.ts";

/** Where "Choose a plan" / "See plans" go: Settings → Billing. */
export const BILLING_SETTINGS_URL = `${CANONICAL_APP_ORIGIN}/settings?section=billing`;
/** The footer's "Notification settings": Settings → Preferences, where the Email switches live (TX-8). */
export const TRIAL_SETTINGS_URL = `${CANONICAL_APP_ORIGIN}/settings?section=preferences`;

/** What Free keeps, in the plan catalog's words (each phrase is one of Free's features). */
export const FREE_KEEPS_PHRASES = ["Tasks, notes, calendar, email and contacts, all linked", "1 workspace", "1 email account"] as const;
/** What Pro adds, in the plan catalog's words (each phrase is part of one of Pro's features). */
export const PRO_ADDS_PHRASES = ["Unlimited workspaces and email accounts", "AI keys that can edit", "Full history", "more storage"] as const;

const FREE_KEEPS = `${FREE_KEEPS_PHRASES[0]}. ${FREE_KEEPS_PHRASES[1]} and ${FREE_KEEPS_PHRASES[2]}.`;
const PRO_ADDS = `${PRO_ADDS_PHRASES[0]}, ${PRO_ADDS_PHRASES[1]}, ${PRO_ADDS_PHRASES[2].toLowerCase()} and ${PRO_ADDS_PHRASES[3]}.`;

/** The three first-week tips. They must name features that exist on the day D1 ships. */
export const WELCOME_TIPS = [
  "Press ⌘K to find anything, or ⌘⇧K to add a task from anywhere.",
  "Drag a task from the calendar's Tasks panel onto a day to give it a time.",
  "Type / in a note to link a task, a contact or a meeting.",
] as const;

export type WelcomeData = {
  /** The display name; the greeting uses its first word. Empty when never set. */
  name: string;
  /** The first workspace's name. */
  workspaceName: string;
  /** ISO time the Pro trial ends; null when there is no trial (a founder, or not started yet). */
  trialEndsAt: string | null;
  /** IANA zone the dates are written in. */
  zone: string;
};

export type TrialEndingData = {
  /** ISO time the trial ends. */
  endsAt: string;
  zone: string;
};

/** D3 prints no date ("ended today": it goes out when the trial ends). */
export type TrialEndedData = Record<string, never>;

// ── payloads ────────────────────────────────────────────────────────────────

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function isoTime(payload: Record<string, unknown>, key: string, kind: string): string {
  const value = text(payload, key);
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${kind}: ${key} missing`);
  return value;
}

export function parseWelcomePayload(payload: Record<string, unknown>): WelcomeData {
  const trialEndsAt = text(payload, "trial_ends_at");
  if (trialEndsAt && Number.isNaN(Date.parse(trialEndsAt))) throw new Error("welcome: trial_ends_at invalid");
  return {
    name: text(payload, "name"),
    workspaceName: text(payload, "workspace_name"),
    trialEndsAt: trialEndsAt || null,
    zone: usableTimeZone(text(payload, "zone")),
  };
}

export function parseTrialEndingPayload(payload: Record<string, unknown>): TrialEndingData {
  return { endsAt: isoTime(payload, "ends_at", "trial_ending"), zone: usableTimeZone(text(payload, "zone")) };
}

export function parseTrialEndedPayload(_payload: Record<string, unknown>): TrialEndedData {
  return {};
}

// ── templates ───────────────────────────────────────────────────────────────

/** The first word of a display name, or "" (no greeting line). */
export function greetingName(name: string): string {
  return singleLine(name, TEXT_LIMITS.name).split(" ")[0] ?? "";
}

/** D1 · Welcome. */
export function welcomeEmail(data: WelcomeData): EmailDoc {
  const first = greetingName(data.name);
  const workspace = singleLine(data.workspaceName, TEXT_LIMITS.name) || "Your workspace";
  return {
    subject: "Welcome to Moduo",
    preheader: "Three things worth trying in your first week.",
    blocks: [
      lockup(),
      ...(first ? [paragraph(`Hi ${first},`)] : []),
      paragraph(`${workspace} is set up. Thanks for trying Moduo this early.`),
      paragraph("Three things worth trying first:"),
      { type: "list", items: WELCOME_TIPS.map((tip) => [tip]) },
      ...(data.trialEndsAt
        ? [
            paragraph(
              `Your Pro trial runs until ${dayLong(new Date(data.trialEndsAt), data.zone)}. Nothing is charged during the beta.`,
            ),
          ]
        : []),
      paragraph("If something breaks or bugs you, reply to this email. We read everything, and one of us writes back."),
      signoff("Maciej & Mike"),
    ],
    footer: { reason: "You got this email because you set up a Moduo workspace." },
  };
}

/** D2 · Trial ends in 3 days. */
export function trialEndingEmail(data: TrialEndingData): EmailDoc {
  const day = dayLong(new Date(data.endsAt), data.zone);
  const weekday = day.split(" ")[0];
  return {
    subject: `Your Pro trial ends on ${weekday}`,
    preheader: "After that you're on Free. Nothing is deleted.",
    blocks: [
      lockup(),
      heading(`Your trial ends on ${day}`),
      paragraph("After that, your account moves to Free. Nothing is deleted, and nothing is charged."),
      {
        type: "rows",
        rows: [
          { label: "Free keeps", value: FREE_KEEPS },
          { label: "Pro adds", value: PRO_ADDS },
        ],
      },
      button("Choose a plan", BILLING_SETTINGS_URL),
      muted("Happy on Free? You don't need to do anything."),
    ],
    footer: {
      reason: "You got this email because your Moduo Pro trial ends soon.",
      links: [{ label: "Notification settings", href: TRIAL_SETTINGS_URL }],
    },
  };
}

/** D3 · Trial ended. */
export function trialEndedEmail(_data: TrialEndedData): EmailDoc {
  return {
    subject: "You're on Moduo Free now",
    preheader: "Everything you made is still here.",
    blocks: [
      lockup(),
      heading("You're on Free now"),
      paragraph("Your Pro trial ended today. Everything you made is still here, and nothing was charged."),
      { type: "rows", rows: [{ label: "Free keeps", value: FREE_KEEPS }] },
      button("See plans", BILLING_SETTINGS_URL),
    ],
    footer: {
      reason: "You got this email because your Moduo Pro trial ended.",
      links: [{ label: "Notification settings", href: TRIAL_SETTINGS_URL }],
    },
  };
}

/** The welcome and trial kinds the outbox worker sends. */
export const TRIAL_QUEUED: Record<"welcome" | "trial_ending" | "trial_ended", (payload: Record<string, unknown>) => QueuedEmail> = {
  welcome: (payload) => ({ doc: welcomeEmail(parseWelcomePayload(payload)) }),
  trial_ending: (payload) => ({ doc: trialEndingEmail(parseTrialEndingPayload(payload)) }),
  trial_ended: (payload) => ({ doc: trialEndedEmail(parseTrialEndedPayload(payload)) }),
};
