// The pinned split-inbox classification order (AC25, `MAIL_CLASSIFY_ORDER`):
// block → rules → per-sender overrides → custom tabs → known contact → header
// heuristics. The reference implementation the fixture engine uses and the Rust
// classifier (MR-3/MR-12) must agree with, case for case.

import type { MailTabKind } from "@contracts/mail";

export type ClassifyInput = {
  fromEmail: string;
  listUnsubscribe?: string | null;
  precedence?: string | null;
  autoSubmitted?: string | null;
};

export type ClassifyContext = {
  blocked?: ReadonlySet<string>;
  /** First matching rule's put_in_tab target, resolved by the rules engine. */
  ruleTab?: (input: ClassifyInput) => MailTabResult | null;
  senderOverrides?: ReadonlyMap<string, MailTabResult>;
  /** Custom tabs in order; each lists senders and domains. */
  customTabs?: readonly { id: string; senders: readonly string[]; domains: readonly string[] }[];
  knownContacts?: ReadonlySet<string>;
};

export type MailTabResult = { kind: MailTabKind; customTabId?: string };
export type Classified = MailTabResult & { blocked: boolean; stage: string };

const NO_REPLY_RE =
  /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|noreply|mailer-?daemon|postmaster|notifications?|alerts?|bounce[s]?)([._+-]|@)/i;

export function headerHeuristicTab(input: ClassifyInput): MailTabKind {
  const auto = input.autoSubmitted?.trim().toLowerCase();
  if ((auto && auto !== "no") || NO_REPLY_RE.test(input.fromEmail)) return "notifications";
  if (input.listUnsubscribe) return "newsletters";
  const p = input.precedence?.trim().toLowerCase();
  if (p === "bulk" || p === "list" || p === "auto" || p === "junk") return "notifications";
  return "personal";
}

export function classifyTab(input: ClassifyInput, ctx: ClassifyContext = {}): Classified {
  const from = input.fromEmail.trim().toLowerCase();
  const domain = from.split("@")[1] ?? "";
  if (ctx.blocked?.has(from) || (domain && ctx.blocked?.has(`@${domain}`))) {
    return { kind: "personal", blocked: true, stage: "block" };
  }
  const rule = ctx.ruleTab?.(input);
  if (rule) return { ...rule, blocked: false, stage: "rules" };
  const override = ctx.senderOverrides?.get(from);
  if (override) return { ...override, blocked: false, stage: "sender_override" };
  for (const tab of ctx.customTabs ?? []) {
    if (tab.senders.includes(from) || tab.domains.includes(domain)) {
      return { kind: "custom", customTabId: tab.id, blocked: false, stage: "custom_tabs" };
    }
  }
  if (ctx.knownContacts?.has(from))
    return { kind: "personal", blocked: false, stage: "known_contact" };
  return { kind: headerHeuristicTab(input), blocked: false, stage: "header_heuristics" };
}
