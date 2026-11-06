import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { MailExplain } from "@/lib/runtime.types.mail-engine";

import { explainWhy, WHY_STEPS, WhyHereCard, type WhyNames } from "./why-here";

afterEach(cleanup);

const NAMES: WhyNames = {
  rules: [{ id: "r-receipts", label: "Receipts" }],
  customTabs: [{ id: "ct-investors", label: "Investors", domains: ["northzone.vc"] }],
};

const why = (over: Partial<MailExplain>): MailExplain => ({
  stage: null,
  ruleId: null,
  customTabId: null,
  address: "ana@acme.test",
  tab: "personal",
  ...over,
});

type Case = {
  explain: MailExplain;
  sender: string;
  heading: string;
  sentence: string;
  step: string;
  link: string;
};

const CASES: Case[] = [
  {
    explain: why({ stage: "block", address: "spam@bad.test" }),
    sender: "Bad Co",
    heading: "Why this is in Personal",
    sentence: "Bad Co is in your blocked senders.",
    step: "Blocked senders",
    link: "Blocked senders in Settings",
  },
  {
    explain: why({ stage: "rules", ruleId: "r-receipts", tab: "notifications" }),
    sender: "Shop",
    heading: "Why this is in Notifications",
    sentence: "Your rule 'Receipts' moved it.",
    step: "Your rules",
    link: "Edit rules in Settings",
  },
  {
    explain: why({ stage: "sender_override", address: "pal@friends.test", tab: "newsletters" }),
    sender: "Pal",
    heading: "Why this is in Newsletters",
    sentence: "You chose Newsletters for Pal.",
    step: "Your choice for this sender",
    link: "Change where Pal goes in Settings → Mail → Rules",
  },
  {
    explain: why({
      stage: "custom_tabs",
      customTabId: "ct-investors",
      address: "dana@northzone.vc",
      tab: "custom",
    }),
    sender: "Dana Ito",
    heading: "Why this is in Investors",
    sentence: "Your Investors tab collects mail from northzone.vc.",
    step: "Custom tabs",
    link: "Edit custom tabs in Settings",
  },
  {
    explain: why({ stage: "known_contact" }),
    sender: "Ana Lopez",
    heading: "Why this is in Personal",
    sentence: "Ana is in your contacts.",
    step: "People in your contacts",
    link: "Change where Ana goes in Settings → Mail → Rules",
  },
  {
    explain: why({ stage: "header_heuristics", address: "hello@lumen.test", tab: "newsletters" }),
    sender: "Lumen",
    heading: "Why this is in Newsletters",
    sentence: "Lumen sends with an unsubscribe header, so it reads as a newsletter.",
    step: "Mailing-list headers",
    link: "Change where Lumen goes in Settings → Mail → Rules",
  },
];

describe("Why is this in {Tab}? (specs/mail-v3.md §8, AC8)", () => {
  it("names the deciding step for each stage", () => {
    expect(CASES.map((c) => c.step)).toEqual(WHY_STEPS.map((s) => s.label));
    for (const [at, c] of CASES.entries()) {
      const onOpenSettings = rs.fn();
      render(
        <WhyHereCard
          answer={explainWhy(c.explain, NAMES, c.sender)}
          onOpenSettings={onOpenSettings}
        />,
      );
      screen.getByRole("heading", { name: c.heading });
      screen.getByText(c.sentence);

      const steps = within(
        screen.getByRole("list", { name: "The order Moduo checks" }),
      ).getAllByRole("listitem");
      expect(steps.map((li) => li.textContent?.replace(" (this decided it)", ""))).toEqual(
        WHY_STEPS.map((s) => s.label),
      );
      // Only the deciding step carries the sr-only mark; the ones before it are dimmed.
      for (const [i, li] of steps.entries()) {
        expect(li.textContent?.includes("(this decided it)")).toBe(i === at);
        expect(li.hasAttribute("data-past")).toBe(i < at);
      }
      expect(steps[at]!.textContent).toBe(`${c.step} (this decided it)`);

      fireEvent.click(screen.getByRole("button", { name: c.link }));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("an old thread without a kept reason: the tab, and the steps without a mark", () => {
    render(
      <WhyHereCard
        answer={explainWhy(why({ stage: null, tab: "personal" }), NAMES, "Ana Lopez")}
        onOpenSettings={() => {}}
      />,
    );
    screen.getByRole("heading", { name: "Why this is in Personal" });
    screen.getByText("Moduo sorted this before it kept a reason. It's in Personal.");
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    for (const li of steps) {
      expect(li.textContent?.includes("(this decided it)")).toBe(false);
      expect(li.hasAttribute("data-past")).toBe(false);
    }
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the sender's address when the custom tab lists the sender, not the domain", () => {
    const answer = explainWhy(
      why({
        stage: "custom_tabs",
        customTabId: "ct-investors",
        address: "kim@seed.vc",
        tab: "custom",
      }),
      NAMES,
      "Kim",
    );
    expect(answer.sentence).toBe("Your Investors tab collects mail from kim@seed.vc.");
  });
});
