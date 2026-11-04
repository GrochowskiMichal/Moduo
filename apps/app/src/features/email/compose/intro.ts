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
