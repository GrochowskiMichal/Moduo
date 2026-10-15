import { describe, expect, it } from "@rstest/core";

import { PLAN_CARDS } from "../../../../../src/features/billing/plans.ts";
import { buildOutboxEmail, OUTBOX_TEMPLATES } from "../outbox.ts";
import { renderEmail } from "../render.ts";
import {
  FREE_KEEPS_PHRASES,
  parseTrialEndedPayload,
  parseTrialEndingPayload,
  parseWelcomePayload,
  PRO_ADDS_PHRASES,
  trialEndedEmail,
  trialEndingEmail,
  welcomeEmail,
} from "./trial.ts";

// The payloads …_tx9a_welcome_trial.sql writes (snake_case, from SQL).
const WELCOME = {
  user_id: "5f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b",
  workspace_id: "6a2e3d4c-5b6a-4f70-9b8c-0d1e2f3a4b5c",
  name: "Tom Becker",
  workspace_name: "Northwind Studio",
  trial_ends_at: "2026-10-22T09:12:00Z",
  zone: "Europe/Warsaw",
};
const ENDING = { user_id: WELCOME.user_id, ends_at: "2026-10-22T09:12:00Z", zone: "Europe/Warsaw" };
const ENDED = { user_id: WELCOME.user_id, ended_at: "2026-10-22T09:12:00Z", zone: "Europe/Warsaw" };

const textOf = (doc: Parameters<typeof renderEmail>[0]) => renderEmail(doc).text;

describe("welcome (D1)", () => {
  it("has the ratified subject, preheader and copy", () => {
    const doc = welcomeEmail(parseWelcomePayload(WELCOME));
    expect(doc.subject).toBe("Welcome to Moduo");
    expect(doc.preheader).toBe("Three things worth trying in your first week.");
    const text = textOf(doc);
    expect(text).toContain("Hi Tom,");
    expect(text).toContain("Northwind Studio is set up. Thanks for trying Moduo this early.");
    expect(text).toContain("Three things worth trying first:");
    expect(text).toContain("Press ⌘K to find anything, or ⌘⇧K to add a task from anywhere.");
    expect(text).toContain("Your Pro trial runs until Thursday 22 October. Nothing is charged during the beta.");
    expect(text).toContain("reply to this email. We read everything, and one of us writes back.");
    expect(text).toContain("Maciej & Mike");
    expect(text).toContain("You got this email because you set up a Moduo workspace.");
  });

  it("is a note, not a pitch: no button and no settings link (it always sends, once)", () => {
    const doc = welcomeEmail(parseWelcomePayload(WELCOME));
    expect(doc.blocks.some((block) => block.type === "button")).toBe(false);
    expect(doc.footer.links ?? []).toEqual([]);
  });

  it("greets by the first word of the name, and leaves the greeting out without one", () => {
    expect(textOf(welcomeEmail(parseWelcomePayload({ ...WELCOME, name: "  Anna  Maria Carter " })))).toContain("Hi Anna,");
    const unnamed = textOf(welcomeEmail(parseWelcomePayload({ ...WELCOME, name: "" })));
    expect(unnamed).not.toContain("Hi ");
    expect(unnamed).toContain("Northwind Studio is set up.");
  });

  it("keeps a name inert: markup and line breaks stay text on one line", () => {
    const doc = welcomeEmail(parseWelcomePayload({ ...WELCOME, name: "<b>Tom</b>\nBecker", workspace_name: "A\nB" }));
    const { html, text } = renderEmail(doc);
    expect(html).not.toContain("<b>Tom");
    expect(text).toContain("Hi <b>Tom</b>,");
    expect(text).toContain("A B is set up.");
  });

  it("writes the trial's end in the recipient's zone, and leaves the line out without a trial", () => {
    const late = { ...WELCOME, trial_ends_at: "2026-10-22T23:30:00Z" };
    expect(textOf(welcomeEmail(parseWelcomePayload({ ...late, zone: "Europe/Warsaw" })))).toContain("Friday 23 October");
    expect(textOf(welcomeEmail(parseWelcomePayload({ ...late, zone: "" })))).toContain("Thursday 22 October");
    const founder = textOf(welcomeEmail(parseWelcomePayload({ ...WELCOME, trial_ends_at: null })));
    expect(founder).not.toContain("trial");
    expect(founder).not.toContain("charged");
  });

  it("refuses a payload whose trial date can't be read", () => {
    expect(() => parseWelcomePayload({ ...WELCOME, trial_ends_at: "soon" })).toThrow("trial_ends_at");
  });
});

describe("trial ends in 3 days (D2)", () => {
  it("has the ratified subject, preheader and copy", () => {
    const doc = trialEndingEmail(parseTrialEndingPayload(ENDING));
    expect(doc.subject).toBe("Your Pro trial ends on Thursday");
    expect(doc.preheader).toBe("After that you're on Free. Nothing is deleted.");
    const text = textOf(doc);
    expect(text).toContain("Your trial ends on Thursday 22 October");
    expect(text).toContain("After that, your account moves to Free. Nothing is deleted, and nothing is charged.");
    expect(text).toContain("Tasks, notes, calendar, email and contacts, all linked. 1 workspace and 1 email account.");
    expect(text).toContain(
      "Unlimited workspaces and email accounts, AI keys that can edit, full history and more storage.",
    );
    expect(text).toContain("Choose a plan");
    expect(text).toContain("https://app.moduo.app/settings?section=billing");
    expect(text).toContain("Happy on Free? You don't need to do anything.");
    expect(text).toContain("You got this email because your Moduo Pro trial ends soon.");
    expect(doc.footer.links).toEqual([
      { label: "Notification settings", href: "https://app.moduo.app/settings?section=preferences" },
    ]);
  });

  it("names the day in the recipient's zone", () => {
    const doc = trialEndingEmail(parseTrialEndingPayload({ ...ENDING, ends_at: "2026-10-22T23:30:00Z" }));
    expect(doc.subject).toBe("Your Pro trial ends on Friday");
    expect(textOf(doc)).toContain("Your trial ends on Friday 23 October");
  });

  it("refuses a payload without the end", () => {
    expect(() => parseTrialEndingPayload({ zone: "UTC" })).toThrow("ends_at");
  });
});

describe("trial ended (D3)", () => {
  it("has the ratified subject, preheader and copy", () => {
    const doc = trialEndedEmail(parseTrialEndedPayload(ENDED));
    expect(doc.subject).toBe("You're on Moduo Free now");
    expect(doc.preheader).toBe("Everything you made is still here.");
    const text = textOf(doc);
    expect(text).toContain("You're on Free now");
    expect(text).toContain("Your Pro trial ended today. Everything you made is still here, and nothing was charged.");
    expect(text).toContain("Tasks, notes, calendar, email and contacts, all linked. 1 workspace and 1 email account.");
    expect(text).not.toContain("Pro adds");
    expect(text).toContain("See plans");
    expect(text).toContain("You got this email because your Moduo Pro trial ended.");
    expect(doc.footer.links?.[0]?.label).toBe("Notification settings");
  });
});

describe("the plan lines", () => {
  // T23: D2/D3's Free/Pro lines stay in step with the Plans page.
  const features = (id: string) => PLAN_CARDS.find((card) => card.id === id)?.features.join(" · ") ?? "";

  it("say only what Free's plan card says", () => {
    for (const phrase of FREE_KEEPS_PHRASES) expect(features("free")).toContain(phrase);
  });

  it("say only what Pro's plan card says", () => {
    for (const phrase of PRO_ADDS_PHRASES) expect(features("pro")).toContain(phrase);
  });
});

describe("the worker", () => {
  it("sends D1–D3 from hello@ under Moduo's name", () => {
    for (const [kind, payload] of [
      ["welcome", WELCOME],
      ["trial_ending", ENDING],
      ["trial_ended", ENDED],
    ] as const) {
      const built = buildOutboxEmail({
        id: "1",
        kind,
        stream: "account",
        to_email: "tom@becker.studio",
        to_user_id: WELCOME.user_id,
        payload,
        dedupe_key: `${kind}:1`,
        attempts: 1,
      });
      expect(built.ok).toBe(true);
      if (built.ok) expect(built.email.from).toBe('"Moduo" <hello@moduo.app>');
      expect(OUTBOX_TEMPLATES[kind]?.(payload).replyTo).toBeUndefined();
    }
  });
});
