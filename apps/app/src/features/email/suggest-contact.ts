// "Add as contact" suggestion (X23, AC30): after you've replied to a
// non-contact 3+ times, suggest adding them. Never automatic, and a dismissed
// suggestion stays dismissed.

import type { MailMessage } from "@/lib/runtime.types.mail-engine";

export const SUGGEST_CONTACT_AFTER_REPLIES = 3;

export type ContactSuggestion = { email: string; name: string; replies: number };

/** Counts your sent messages to each recipient across the given messages. */
export function suggestContacts(
  messages: readonly MailMessage[],
  opts: {
    ownAddresses: ReadonlySet<string>;
    contacts: ReadonlySet<string>;
    dismissed?: ReadonlySet<string>;
  },
): ContactSuggestion[] {
  const own = lower(opts.ownAddresses);
  const contacts = lower(opts.contacts);
  const dismissed = lower(opts.dismissed ?? new Set());
  const tally = new Map<string, ContactSuggestion>();
  for (const m of messages) {
    if (!own.has(m.from.email.toLowerCase())) continue;
    const seen = new Set<string>();
    for (const r of [...m.to, ...m.cc]) {
      const e = r.email.trim().toLowerCase();
      if (!e || seen.has(e) || own.has(e) || contacts.has(e) || dismissed.has(e)) continue;
      seen.add(e);
      const cur = tally.get(e) ?? { email: e, name: r.name, replies: 0 };
      cur.replies += 1;
      if (!cur.name && r.name) cur.name = r.name;
      tally.set(e, cur);
    }
  }
  return [...tally.values()]
    .filter((s) => s.replies >= SUGGEST_CONTACT_AFTER_REPLIES)
    .sort((a, b) => b.replies - a.replies || a.email.localeCompare(b.email));
}

function lower(s: ReadonlySet<string>): Set<string> {
  return new Set([...s].map((x) => x.toLowerCase()));
}
