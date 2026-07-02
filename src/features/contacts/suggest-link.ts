// Contact-attributed suggestion accept/decline (block CO-4, specs/contacts.md
// AC7). The deterministic suggestions come from the spine engine (CT-6), but a
// contact accepting one must write through `contacts_op_link` (origin='suggest')
// so the action is attributed to Contacts — not the generic `links_op_create`.
// Decline is the spine's per-pair "remember my no". These pure mappers are the
// AC7 proof; the hook (use-contact-suggestions) performs the writes.

import type { EntityRef } from "../../lib/entity-links";
import { coerceKindForPair } from "../spine/kind-constraints";
import type { LinkSuggestion } from "../spine/suggest";

/** The `runtime.contacts.link` args that accept a suggestion (AC7). */
export type ContactSuggestLinkArgs = {
  contact: EntityRef;
  target: EntityRef;
  relationKind: LinkSuggestion["suggestedKind"];
  origin: "suggest";
  targetLabel?: string;
  targetIcon?: string | null;
};

/** Map a scored spine suggestion → the contacts.link call that accepts it. The
 * suggested kind is coerced to one sensible for the endpoint pair (FX-5) so an
 * errant suggestion can never persist a nonsense edge (e.g. attachment between
 * two people). */
export function contactSuggestLinkArgs(contact: EntityRef, s: LinkSuggestion): ContactSuggestLinkArgs {
  return {
    contact,
    target: s.other,
    relationKind: coerceKindForPair(s.suggestedKind, contact.type, s.other.type),
    origin: "suggest",
    targetLabel: s.label,
    targetIcon: s.icon,
  };
}

/** The `runtime.spine.declineSuggestion` args that remember a "no" (AC7). */
export function contactDeclineArgs(
  contact: EntityRef,
  s: LinkSuggestion,
): { source: EntityRef; target: EntityRef } {
  return { source: contact, target: s.other };
}
