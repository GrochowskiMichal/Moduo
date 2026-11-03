// The deterministic reference mailbox (specs/mail-rebuild.md decision 18):
// 6 accounts, 100,000 messages by default, the same output for the same seed.
// It feeds the fixture engine (stories, unit tests, lab journeys), the Maildir
// trees for the Dovecot harness and the JSONL rows for the Rust perf tests
// (`scripts/mail/write-fixture.ts`), so every layer measures one mailbox.

import { MAIL_FLAG_BITS, type MailMailboxRole, type MailProvider } from "@contracts/mail";

export const FIXTURE_DEFAULT_SEED = 0x6d61696c; // "mail"
export const FIXTURE_DEFAULT_MESSAGES = 100_000;
/** Fixed "now" so dates are stable: 2026-11-03T09:00:00Z. */
export const FIXTURE_NOW_MS = Date.UTC(2026, 10, 3, 9, 0, 0);

export type FixtureAccount = {
  id: string;
  address: string;
  displayName: string;
  provider: MailProvider;
  hue: number;
};

export type FixtureMessage = {
  id: string;
  accountId: string;
  mailboxRole: MailMailboxRole;
  threadId: string;
  messageId: string;
  inReplyTo: string | null;
  fromName: string;
  fromEmail: string;
  to: string[];
  subject: string;
  snippet: string;
  bodyText: string;
  dateMs: number;
  flags: number;
  listUnsubscribe: string | null;
  precedence: string | null;
  autoSubmitted: string | null;
  attachmentNames: string[];
  hasInvite: boolean;
};

export type Fixture = { accounts: FixtureAccount[]; messages: FixtureMessage[] };

/** mulberry32: tiny, fast, deterministic. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIXTURE_ACCOUNTS: FixtureAccount[] = [
  {
    id: "acc-gmail",
    address: "mike@gmail.test",
    displayName: "Mike (Gmail)",
    provider: "gmail",
    hue: 12,
  },
  {
    id: "acc-work",
    address: "mike@moduo.test",
    displayName: "Moduo",
    provider: "google_workspace",
    hue: 210,
  },
  {
    id: "acc-icloud",
    address: "mike@icloud.test",
    displayName: "iCloud",
    provider: "icloud",
    hue: 280,
  },
  {
    id: "acc-outlook",
    address: "mike@outlook.test",
    displayName: "Outlook",
    provider: "outlook",
    hue: 190,
  },
  {
    id: "acc-m365",
    address: "mike@studio.test",
    displayName: "Studio",
    provider: "outlook",
    hue: 140,
  },
  {
    id: "acc-imap",
    address: "mike@fastmail.test",
    displayName: "Fastmail",
    provider: "imap",
    hue: 45,
  },
];

const FIRST = [
  "Anna",
  "Ben",
  "Chloe",
  "Dawid",
  "Ewa",
  "Felix",
  "Grace",
  "Hugo",
  "Iga",
  "Jonas",
  "Kasia",
  "Leo",
  "Maja",
  "Noah",
  "Ola",
  "Piotr",
];
const LAST = [
  "Nowak",
  "Smith",
  "Kowalski",
  "Chen",
  "Garcia",
  "Müller",
  "Rossi",
  "Kim",
  "Dubois",
  "Silva",
];
const DOMAINS = ["acme.test", "studio.test", "client.test", "agency.test", "uni.test"];
const BULK = [
  { name: "GitHub", email: "notifications@github.test", kind: "notify" },
  { name: "Linear", email: "no-reply@linear.test", kind: "notify" },
  { name: "Stripe", email: "receipts@stripe.test", kind: "auto" },
  { name: "The Weekly", email: "hello@weekly.test", kind: "news" },
  { name: "Design Digest", email: "digest@design.test", kind: "news" },
  { name: "Product Notes", email: "editor@productnotes.test", kind: "news" },
] as const;
const TOPICS = [
  "Q4 roadmap",
  "Invoice",
  "Lunch on Friday",
  "Design review",
  "Contract draft",
  "Trip plans",
  "Weekly sync",
  "Feedback on mockups",
  "Offsite agenda",
  "Hiring loop",
];
const WORDS =
  "the a quick update on our plan please see attached notes thanks for the review we should meet next week to discuss details and timeline".split(
    " ",
  );
const ROLES: { role: MailMailboxRole; weight: number }[] = [
  { role: "inbox", weight: 0.45 },
  { role: "archive", weight: 0.35 },
  { role: "sent", weight: 0.12 },
  { role: "trash", weight: 0.04 },
  { role: "spam", weight: 0.02 },
  { role: "drafts", weight: 0.02 },
];

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)] as T;
}

function words(rng: () => number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pick(rng, WORDS));
  return out.join(" ");
}

function pickRole(rng: () => number): MailMailboxRole {
  let r = rng();
  for (const { role, weight } of ROLES) {
    if ((r -= weight) <= 0) return role;
  }
  return "inbox";
}

/**
 * Generates the reference mailbox. Threads average ~2.5 messages; dates span
 * about 3 years back from `FIXTURE_NOW_MS`, newest first in id order.
 */
export function generateFixture(
  opts: { seed?: number; messages?: number; accounts?: number } = {},
): Fixture {
  const rng = createRng(opts.seed ?? FIXTURE_DEFAULT_SEED);
  const total = opts.messages ?? FIXTURE_DEFAULT_MESSAGES;
  const accounts = FIXTURE_ACCOUNTS.slice(0, opts.accounts ?? FIXTURE_ACCOUNTS.length);
  const messages: FixtureMessage[] = [];
  const span = 3 * 365 * 24 * 3600 * 1000;
  let threadSeq = 0;
  let i = 0;
  while (i < total) {
    const account = accounts[threadSeq % accounts.length] as FixtureAccount;
    const threadId = `${account.id}:t${threadSeq++}`;
    const bulk = rng() < 0.35 ? pick(rng, BULK) : null;
    const len = bulk ? 1 : 1 + Math.floor(rng() * 4);
    const role = pickRole(rng);
    const person = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    const personEmail = `${person.split(" ")[0]!.toLowerCase()}@${pick(rng, DOMAINS)}`;
    const subject = bulk ? `${bulk.name}: ${pick(rng, TOPICS)}` : pick(rng, TOPICS);
    // Index-driven date so newer ids are newer mail, with jitter.
    const base = FIXTURE_NOW_MS - Math.floor((i / total) * span);
    let prevId: string | null = null;
    for (let k = 0; k < len && i < total; k++, i++) {
      const id = `m${i}`;
      const messageId = `<${id}.${threadSeq}@fixture.moduo.test>`;
      const fromMe = !bulk && role !== "sent" ? k % 2 === 1 : role === "sent";
      const body = words(rng, 20 + Math.floor(rng() * 60));
      const unread = role === "inbox" && rng() < 0.3;
      let flags = unread ? 0 : MAIL_FLAG_BITS.seen;
      if (rng() < 0.03) flags |= MAIL_FLAG_BITS.flagged;
      if (role === "drafts") flags |= MAIL_FLAG_BITS.draft;
      const attach =
        rng() < 0.12
          ? [
              `${pick(rng, ["report", "invoice", "photo", "deck"])}-${i}.${pick(rng, ["pdf", "png", "key", "xlsx"])}`,
            ]
          : [];
      messages.push({
        id,
        accountId: account.id,
        mailboxRole: role,
        threadId,
        messageId,
        inReplyTo: prevId,
        fromName: bulk ? bulk.name : fromMe ? account.displayName : person,
        fromEmail: bulk ? bulk.email : fromMe ? account.address : personEmail,
        to: [fromMe ? personEmail : account.address],
        subject: k === 0 ? subject : `Re: ${subject}`,
        snippet: body.slice(0, 120),
        bodyText: body,
        dateMs: base - (len - 1 - k) * 3_600_000 - Math.floor(rng() * 600_000),
        flags,
        listUnsubscribe:
          bulk?.kind === "news" ? `<https://${bulk.email.split("@")[1]}/unsub>` : null,
        precedence: bulk?.kind === "news" ? "bulk" : null,
        autoSubmitted: bulk?.kind === "auto" ? "auto-generated" : null,
        attachmentNames: attach,
        hasInvite: !bulk && rng() < 0.01,
      });
      prevId = messageId;
    }
  }
  return { accounts, messages };
}
