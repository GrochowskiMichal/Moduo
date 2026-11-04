// `mailto:` URIs (RFC 6068, AC24) → a compose prefill, mirroring the Rust
// `mail::mailto::parse_mailto` the deep link uses. Only safe hfields are kept
// (to, cc, bcc, subject, body, in-reply-to); `+` stays a plus.

export type MailtoPrefill = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  inReplyTo: string | null;
};

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function addresses(raw: string): string[] {
  return decode(raw)
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function applyMailtoPair(out: MailtoPrefill, pair: string): void {
  const eq = pair.indexOf("=");
  if (eq < 0) return;
  const key = decode(pair.slice(0, eq)).toLowerCase();
  const value = pair.slice(eq + 1);
  if (key === "to") out.to.push(...addresses(value));
  else if (key === "cc") out.cc.push(...addresses(value));
  else if (key === "bcc") out.bcc.push(...addresses(value));
  else if (key === "subject") out.subject = decode(value);
  else if (key === "body") out.body = decode(value).replace(/\r\n/g, "\n");
  else if (key === "in-reply-to") out.inReplyTo = decode(value);
}

export function parseMailto(uri: string): MailtoPrefill | null {
  if (!/^mailto:/i.test(uri.trim())) return null;
  const rest = uri.trim().slice(7);
  const q = rest.indexOf("?");
  const out: MailtoPrefill = {
    to: addresses(q >= 0 ? rest.slice(0, q) : rest),
    cc: [],
    bcc: [],
    subject: "",
    body: "",
    inReplyTo: null,
  };
  if (q >= 0) {
    for (const pair of rest.slice(q + 1).split("&")) applyMailtoPair(out, pair);
  }
  return out;
}

/** Click handler for links in Moduo (reader, notes, …): mailto opens compose. */
export function interceptMailto(
  event: { target: EventTarget | null; preventDefault(): void },
  open: (prefill: MailtoPrefill) => void,
): boolean {
  const el = event.target instanceof Element ? event.target.closest("a[href]") : null;
  const href = el?.getAttribute("href") ?? "";
  const prefill = parseMailto(href);
  if (!prefill) return false;
  event.preventDefault();
  open(prefill);
  return true;
}

/** Drains pending `mailto:` deep links (AC24) and opens compose for each valid one. */
export async function drainMailto(
  take: () => Promise<string[]>,
  open: (prefill: MailtoPrefill) => Promise<unknown> | void,
): Promise<number> {
  let opened = 0;
  for (const uri of await take()) {
    const prefill = parseMailto(uri);
    if (!prefill) continue;
    await open(prefill);
    opened++;
  }
  return opened;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fills a new-message compose spec from a mailto prefill; the body is escaped text. */
export function applyMailtoPrefill<
  T extends {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    bodyHtml: string;
    inReplyTo: string | null;
  },
>(spec: T, p: MailtoPrefill): T {
  const body = p.body
    ? p.body
        .split("\n")
        .map((line) => `<p>${line ? escapeHtml(line) : "<br>"}</p>`)
        .join("")
    : spec.bodyHtml;
  return {
    ...spec,
    to: p.to.join(", "),
    cc: p.cc.join(", "),
    bcc: p.bcc.join(", "),
    subject: p.subject || spec.subject,
    bodyHtml: body,
    inReplyTo: p.inReplyTo ?? spec.inReplyTo,
  };
}
