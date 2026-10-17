// AC7 proof: a contact accepting a spine suggestion writes through contacts.link
// (origin='suggest'); declining records the pair for the spine to remember.

import { describe, expect, it } from "@rstest/core";
import type { EntityRef } from "../../lib/entity-links";
import type { LinkSuggestion } from "../spine/suggest";
import { contactDeclineArgs, contactSuggestLinkArgs } from "./suggest-link";

const contact: EntityRef = { type: "contact", id: "c1" };
const suggestion: LinkSuggestion = {
  other: { type: "company", id: "co1" },
  label: "Acme",
  icon: "building-2",
  signals: ["email-domain"],
  suggestedKind: "works-at",
  score: 3,
};

describe("contactSuggestLinkArgs", () => {
  it("accepts via contacts.link with origin='suggest' and the suggested kind", () => {
    expect(contactSuggestLinkArgs(contact, suggestion)).toEqual({
      contact,
      target: { type: "company", id: "co1" },
      relationKind: "works-at",
      origin: "suggest",
      targetLabel: "Acme",
      targetIcon: "building-2",
    });
  });
});

describe("contactDeclineArgs", () => {
  it("remembers the declined pair (source=contact, target=other)", () => {
    expect(contactDeclineArgs(contact, suggestion)).toEqual({
      source: contact,
      target: { type: "company", id: "co1" },
    });
  });
});
