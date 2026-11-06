// The instant-intro key (AC23): replying to an introduction moves the person
// who introduced you to Bcc and opens the reply with a "Moving X to Bcc" line,
// the convention Superhuman made common.

import { addressEmail, splitAddresses } from "../compose";
import { joinEntries, personEntry, splitEntries } from "./address-list";

export type IntroFields = { to: string; cc: string; bcc: string; bodyHtml: string };

/** The introducer as the banner names them: the display name, else the address's local part. */
export function introducerName(raw: string): string {
  const m = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  return addressEmail(raw).split("@")[0] ?? raw;
}

/** "Priya Shah" → "Priya", for "Move Priya to Bcc". */
export function introducerFirstName(raw: string): string {
  return introducerName(raw).split(/\s+/)[0] ?? "";
}

const thanksLine = (first: string) => `<p>Thanks ${first} (moving you to Bcc).</p>`;

export function instantIntro(fields: IntroFields, introducer: string): IntroFields {
  const who = addressEmail(introducer);
  if (!who) return fields;
  // Everyone else keeps their entry as typed ("Name <address>").
  const drop = (list: string) =>
    joinEntries(splitEntries(list).filter((e) => addressEmail(e) !== who));
  const bcc = splitAddresses(fields.bcc);
  if (!bcc.includes(who)) bcc.push(who);
  return {
    to: drop(fields.to),
    cc: drop(fields.cc),
    bcc: bcc.join(", "),
    bodyHtml: `${thanksLine(introducerFirstName(introducer))}${fields.bodyHtml}`,
  };
}

/** Undo of the intro move: the introducer leaves Bcc, returns to the front of To, and the
 *  "Thanks … (moving you to Bcc)" line goes. */
export function undoInstantIntro(fields: IntroFields, introducer: string): IntroFields {
  const who = addressEmail(introducer);
  if (!who) return fields;
  const to = splitEntries(fields.to).filter((e) => addressEmail(e) !== who);
  const line = thanksLine(introducerFirstName(introducer));
  return {
    to: joinEntries([introducer.trim(), ...to]),
    cc: fields.cc,
    bcc: splitAddresses(fields.bcc)
      .filter((a) => a !== who)
      .join(", "),
    bodyHtml: fields.bodyHtml.startsWith(line)
      ? fields.bodyHtml.slice(line.length)
      : fields.bodyHtml,
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
  // personEntry drops a comma in the name ("Shah, Priya"), which would split the entry.
  return personEntry(last.from);
}
