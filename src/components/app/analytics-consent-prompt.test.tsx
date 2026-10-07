import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  ANALYTICS_CONSENT_ASK_DELAY_MS,
  ANALYTICS_CONSENT_TOAST_ID,
  AnalyticsConsentCard,
  AnalyticsConsentPrompt,
} from "./analytics-consent-prompt";

const h = rs.hoisted(() => ({
  toast: { custom: rs.fn(), dismiss: rs.fn() },
  setAnalyticsConsent: rs.fn(() => Promise.resolve()),
  state: {
    userId: "u1" as string | null,
    consent: null as "granted" | "denied" | null,
    available: true,
    runtime: null as null | { window: { openExternalUrl: (url: string) => Promise<void> } },
  },
}));

rs.mock("sonner", () => ({ toast: h.toast }));
rs.mock("../../lib/analytics", () => ({
  isAnalyticsAvailable: () => h.state.available,
  useAnalyticsConsent: () => h.state.consent,
  setAnalyticsConsent: h.setAnalyticsConsent,
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({ userId: h.state.userId, runtime: h.state.runtime }),
}));

/** Render the card the prompt handed to the toaster. */
function renderShownCard() {
  const factory = h.toast.custom.mock.calls.at(-1)?.[0] as (id: string) => ReactElement;
  return render(factory(ANALYTICS_CONSENT_TOAST_ID));
}

beforeEach(() => {
  rs.useFakeTimers();
  h.toast.custom.mockClear();
  h.toast.dismiss.mockClear();
  h.setAnalyticsConsent.mockClear();
  Object.assign(h.state, { userId: "u1", consent: null, available: true, runtime: null });
});

afterEach(() => {
  cleanup();
  rs.useRealTimers();
});

describe("AnalyticsConsentPrompt", () => {
  // First on purpose: the settle delay applies to the first ask of a session only.
  it("asks once the app has settled, for a signed-in person who hasn't answered", () => {
    render(<AnalyticsConsentPrompt />);
    rs.advanceTimersByTime(ANALYTICS_CONSENT_ASK_DELAY_MS - 1);
    expect(h.toast.custom).not.toHaveBeenCalled();

    rs.advanceTimersByTime(1);
    expect(h.toast.custom).toHaveBeenCalledTimes(1);
    expect(h.toast.custom.mock.calls[0][1]).toEqual({
      id: ANALYTICS_CONSENT_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      dismissible: false,
    });
  });

  it.each([
    ["the person already said yes", { consent: "granted" as const }],
    ["the person already said no", { consent: "denied" as const }],
    ["nobody is signed in", { userId: null }],
    ["analytics isn't available (no key, or Do Not Track)", { available: false }],
  ])("doesn't ask when %s", (_label, state) => {
    Object.assign(h.state, state);
    render(<AnalyticsConsentPrompt />);
    rs.advanceTimersByTime(ANALYTICS_CONSENT_ASK_DELAY_MS);

    expect(h.toast.custom).not.toHaveBeenCalled();
  });

  it.each([
    ["Share", "granted"],
    ["Don't share", "denied"],
  ])("%s records the answer for this person and closes the question", (label, choice) => {
    render(<AnalyticsConsentPrompt />);
    rs.advanceTimersByTime(ANALYTICS_CONSENT_ASK_DELAY_MS);
    renderShownCard();

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(h.setAnalyticsConsent).toHaveBeenCalledWith("u1", choice);
    expect(h.toast.dismiss).toHaveBeenCalledWith(ANALYTICS_CONSENT_TOAST_ID);
  });

  it("closes the question when it's answered elsewhere (Settings, another tab)", () => {
    const { rerender } = render(<AnalyticsConsentPrompt />);
    rs.advanceTimersByTime(ANALYTICS_CONSENT_ASK_DELAY_MS);
    expect(h.toast.custom).toHaveBeenCalledTimes(1);

    h.state.consent = "granted";
    rerender(<AnalyticsConsentPrompt />);

    expect(h.toast.dismiss).toHaveBeenCalledWith(ANALYTICS_CONSENT_TOAST_ID);
  });

  it("opens the privacy policy outside the app on desktop", () => {
    const openExternalUrl = rs.fn(() => Promise.resolve());
    h.state.runtime = { window: { openExternalUrl } };
    render(<AnalyticsConsentPrompt />);
    rs.advanceTimersByTime(ANALYTICS_CONSENT_ASK_DELAY_MS);
    renderShownCard();

    const link = screen.getByRole("link", { name: "Privacy policy" });
    const notPrevented = fireEvent.click(link);

    expect(openExternalUrl).toHaveBeenCalledWith("https://moduo.app/privacy#analytics");
    expect(notPrevented).toBe(false);
  });
});

describe("AnalyticsConsentCard", () => {
  it("gives saying no the same weight as saying yes", () => {
    render(<AnalyticsConsentCard onChoose={() => {}} />);

    const no = screen.getByRole("button", { name: "Don't share" });
    const yes = screen.getByRole("button", { name: "Share" });
    expect(no.className).toBe(yes.className);
    expect(screen.getByRole("group", { name: "Help us improve Moduo?" })).toBeTruthy();
  });
});
