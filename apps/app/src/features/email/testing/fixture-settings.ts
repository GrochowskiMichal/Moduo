// The Settings items the fixture engine's lab states read in place of the Settings mirror
// (specs/mail-v3.md MV-12): three custom tabs (the `investors` state), an alias per account
// plus one more on the work account (`alias`), and `;;` snippets. Each comes from a lab
// scenario in `localStorage["moduo:mail:fixture-scenario"]`; none is real Settings data.

import type { EmailSettingsItem } from "@/lib/runtime.types.email";

import type { FakeClassifyOptions } from "./fake-engine";
import { FIXTURE_ACCOUNTS } from "./fixture";

export const FIXTURE_SETTINGS_SCENARIOS = ["customTabs", "aliases", "snippets"] as const;

/** Custom tabs over the fixture's correspondent domains, in position order. */
const CUSTOM_TABS = [
  { id: "ct-investors", name: "Investors", domains: ["client.test"] },
  { id: "ct-agency", name: "Agency", domains: ["agency.test"] },
  { id: "ct-uni", name: "University", domains: ["uni.test"] },
];

const SNIPPETS = [
  { name: "thanks", body: "Thanks {first name}, that works for me. I'll confirm by Friday." },
  { name: "intro", body: "Hi {first name}, great to meet you. Adding a few times below." },
];

const item = (
  id: string,
  kind: EmailSettingsItem["kind"],
  position: number,
  value: Record<string, unknown>,
): EmailSettingsItem => ({
  id,
  kind,
  position,
  value,
  updatedAt: "2026-11-03T09:00:00.000Z",
  deletedAt: null,
});

function aliasItems(): EmailSettingsItem[] {
  const own = FIXTURE_ACCOUNTS.map((a, i) =>
    item(`alias-${a.id}`, "alias", i, {
      accountId: a.id,
      address: a.address,
      name: "Mike",
      isDefault: true,
      signatureHtml: `<p>Mike · ${a.displayName}</p>`,
    }),
  );
  const extra = item("alias-hello", "alias", own.length, {
    accountId: "acc-work",
    address: "hello@moduo.test",
    name: "Moduo",
    isDefault: false,
    signatureHtml: "<p>The Moduo team</p>",
  });
  return [...own, extra];
}

/** The Settings items the scenario names, for the page's Settings reads in fixture mode. */
export function fixtureSettingsItems(scenario: readonly string[]): EmailSettingsItem[] {
  const on = new Set(scenario);
  const out: EmailSettingsItem[] = [];
  if (on.has("customTabs")) {
    CUSTOM_TABS.forEach((t, i) =>
      out.push(item(t.id, "custom_tab", i, { name: t.name, domains: t.domains })),
    );
  }
  if (on.has("aliases")) out.push(...aliasItems());
  if (on.has("snippets")) {
    SNIPPETS.forEach((s, i) => out.push(item(`snippet-${s.name}`, "snippet", i, s)));
  }
  return out;
}

/** What the fixture engine classifies by for the scenario (the custom tabs' domains). */
export function fixtureClassify(scenario: readonly string[]): FakeClassifyOptions {
  if (!scenario.includes("customTabs")) return {};
  return {
    customTabs: CUSTOM_TABS.map((t) => ({ id: t.id, senders: [], domains: t.domains })),
  };
}
