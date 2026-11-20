import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailExplain, MailThread } from "@/lib/runtime.types.mail-engine";

import { SETTINGS_OPEN_EVENT, type SettingsOpenDetail } from "../../settings/settings-events";
import { message, NOW, oneThreadEngine, row } from "../testing/reader-kit";
import { MailReader } from "./mail-reader";
import { explainWhy, WHY_STEPS, WhyHereCard, WhyHereSheet, type WhyNames } from "./why-here";

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
      const label = (li: HTMLElement) => li.querySelector("[data-step-label]")?.textContent;
      expect(steps.map(label)).toEqual(WHY_STEPS.map((s) => s.label));
      // The decider says "decided it"; the steps before it are dimmed and say "didn't match".
      for (const [i, li] of steps.entries()) {
        expect(li.querySelector("[data-step-tag]")?.textContent ?? null).toBe(
          i === at ? "decided it" : i < at ? "didn't match" : null,
        );
        expect(li.hasAttribute("data-past")).toBe(i < at);
      }

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
      expect(li.querySelector("[data-step-tag]")).toBeNull();
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

// specs/mail-improve.md MI-0, AC15: "Why here?" is a sheet inside the reader, under the
// sender card; the subject stays visible; no strikethrough; Settings opens at Mail → Rules.
describe("sheet under the card, no strikethrough, rules link (AC15)", () => {
  const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));
  const THREAD: MailThread = { row: row({ subject: "Pilot week" }), messages: [message()] };

  it("renders in the reader body under the who-card and opens Settings at Mail → Rules", async () => {
    const explain: MailExplain = {
      stage: "rules",
      ruleId: "r-receipts",
      customTabId: null,
      address: "jonas@acme.test",
      tab: "notifications",
    };
    const engine = oneThreadEngine(() => THREAD, { explainThread: async () => explain });
    const ui = render(
      <TooltipProvider>
        <MailReader
          engine={engine}
          threadId="t1"
          version={0}
          behavior={{ remoteImages: "block", trackerBlocking: true }}
          now={() => NOW}
          selfAddresses={["robin@me.test"]}
          who={{ lookup: async () => null, screened: false }}
          more={{
            unread: rs.fn(),
            move: rs.fn(),
            mute: rs.fn(),
            copyLink: rs.fn(),
            block: rs.fn(),
            spam: rs.fn(),
            delete: rs.fn(),
          }}
          why={{ names: NAMES }}
        />
      </TooltipProvider>,
    );
    await tick();
    await tick();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More actions" }), {
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Why is this in Notifications?" }));
    await tick();

    const sheet = screen.getByRole("region", { name: "Why this is in Notifications" });
    // In the reader, after the who-card, and the subject is still on screen.
    const reader = ui.container.querySelector("[data-reader-thread]")!;
    expect(reader.contains(sheet)).toBe(true);
    const card = screen.getByRole("region", { name: "Who this is from" });
    expect(card.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    screen.getByRole("heading", { name: "Pilot week" });
    // No popover, no strikethrough.
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(sheet.querySelector(".line-through")).toBeNull();
    expect(within(sheet).getAllByText("didn't match")).toHaveLength(1);
    within(sheet).getByText("decided it");

    const seen: SettingsOpenDetail[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent<SettingsOpenDetail>).detail);
    window.addEventListener(SETTINGS_OPEN_EVENT, listen);
    fireEvent.click(within(sheet).getByRole("button", { name: "Edit rules in Settings" }));
    window.removeEventListener(SETTINGS_OPEN_EVENT, listen);
    expect(seen).toEqual([{ section: "mail", sub: "rules" }]);
    expect(screen.queryByRole("region", { name: "Why this is in Notifications" })).toBeNull();
  });

  it("Esc and × close it", () => {
    const onClose = rs.fn();
    render(
      <WhyHereSheet answer={explainWhy(CASES[1]!.explain, NAMES, "Shop")} onClose={onClose} />,
    );
    const sheet = screen.getByRole("region", { name: "Why this is in Notifications" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
