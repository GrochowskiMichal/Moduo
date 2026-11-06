// The instant-intro key (AC23): replying to an introduction moves the person
// who introduced you to Bcc and opens the reply with a "Moving X to Bcc" line,
// the convention Superhuman made common.

import { addressEmail, splitAddresses } from "../compose";

export type IntroFields = { to: string; cc: string; bcc: string; bodyHtml: string };

function displayName(raw: string): string {
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  return addressEmail(raw).split("@")[0] ?? raw;
}

export function instantIntro(fields: IntroFields, introducer: string): IntroFields {
  const who = addressEmail(introducer);
  if (!who) return fields;
  const drop = (list: string) =>
    splitAddresses(list)
      .filter((a) => a !== who)
      .join(", ");
  const bcc = splitAddresses(fields.bcc);
  if (!bcc.includes(who)) bcc.push(who);
  const first = displayName(introducer).split(/\s+/)[0];
  return {
    to: drop(fields.to),
    cc: drop(fields.cc),
    bcc: bcc.join(", "),
    bodyHtml: `<p>Thanks ${first} (moving you to Bcc).</p>${fields.bodyHtml}`,
  };
}

type Person = { name: string; email: string };

/**
 * Who introduced you in the message you're replying to: its sender, when they
 * put someone in Cc who wasn't on the thread before. With two new people it
 * still names the sender; a message you sent yourself is never an intro.
 * Returns "Name <address>", the form `instantIntro` reads.
 */
export function detectIntroducer(
  messages: readonly { from: Person; to: readonly Person[]; cc: readonly Person[] }[],
  selfAddresses: readonly string[],
): string | null {
  const last = messages.at(-1);
  if (!last) return null;
  const self = new Set(selfAddresses.map((a) => a.toLowerCase()));
  const sender = last.from.email.toLowerCase();
  if (!sender || self.has(sender)) return null;
  const before = new Set(
    messages
      .slice(0, -1)
      .flatMap((m) => [m.from, ...m.to, ...m.cc])
      .map((p) => p.email.toLowerCase()),
  );
  const added = last.cc.some((p) => {
    const e = p.email.toLowerCase();
    return e !== sender && !self.has(e) && !before.has(e);
  });
  if (!added) return null;
  return last.from.name ? `${last.from.name} <${last.from.email}>` : last.from.email;
}
