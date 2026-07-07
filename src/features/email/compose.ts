// Compose prefill + body helpers (EM-7, AC10). Pure: given a thread + the account
// you're sending from, build the reply / reply-all / forward draft (recipients,
// Re:/Fwd: subject, In-Reply-To/References threading headers, quoted original,
// signature) and convert between the editor's HTML and the plain-text alternative.
// No I/O — the send itself (runtime.email.sendMessage) + the 10s undo timer live in
// the hook.

import type { EmailEnvelope, EmailThread } from "./model/email-types";

export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

/** A staged attachment — a picked file (has a path) sent by the engine. */
export type ComposeAttachmentDraft = {
  path: string;
  filename: string;
  mimeType: string;
  size?: number;
};

/** The compose surface's editable state. */
export type ComposeDraft = {
  mode: ComposeMode;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** Initial editor HTML (signature + any quoted original). */
  bodyHtml: string;
  inReplyTo: string | null;
  references: string[];
  attachments: ComposeAttachmentDraft[];
};

/** How many References ids to keep (RFC 5322 says trim old ones on long threads). */
const MAX_REFERENCES = 20;

/** Strip any run of leading "Re:" / "Fwd:" / "Fw:" (case-insensitive). */
export function stripReFwd(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
}

export function replySubject(subject: string): string {
  return `Re: ${stripReFwd(subject)}`.trim();
}

export function forwardSubject(subject: string): string {
  return `Fwd: ${stripReFwd(subject)}`.trim();
}

/** Parse "Name <email>" / "email" → its bare, lowercased address (or ""). */
export function addressEmail(raw: string): string {
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : raw).trim().toLowerCase();
  return /\S+@\S+/.test(candidate) ? candidate : "";
}

/** Split a header recipient string ("a@x, b@y") into bare addresses. */
export function splitAddresses(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => addressEmail(part))
    .filter(Boolean);
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Derive the plain-text alternative from the editor HTML (block-aware). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<\s*blockquote[^>]*>/gi, "> ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Escape + wrap plain text as minimal HTML (newlines → <br>). */
export function plainToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\n/g, "<br>");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An attribution + blockquote of the message being replied to / forwarded. */
function quotedOriginal(
  anchor: EmailEnvelope | undefined,
  mode: ComposeMode,
): string {
  if (!anchor) return "";
  const who = escapeHtml(anchor.sender || anchor.senderEmail || "");
  const when = escapeHtml(anchor.date || "");
  const bodyHtml = anchor.preview ? escapeHtml(anchor.preview) : "";
  if (mode === "forward") {
    return (
      `<br><br>---------- Forwarded message ----------<br>` +
      `From: ${who}<br>Date: ${when}<br>` +
      `Subject: ${escapeHtml(anchor.subject || "")}<br><br>` +
      `${bodyHtml}`
    );
  }
  return (
    `<br><br><div>On ${when}, ${who} wrote:</div>` +
    `<blockquote>${bodyHtml}</blockquote>`
  );
}

/** Prepend the account signature (if any) above a quoted original. */
export function composeInitialBody(signatureHtml: string, quoted: string): string {
  const sig = signatureHtml.trim() ? `<br><br>${signatureHtml.trim()}` : "";
  return `<br>${sig}${quoted}`;
}

type BuildArgs = {
  mode: Exclude<ComposeMode, "new">;
  thread: EmailThread;
  /** The thread's messages, oldest → newest (from getThread). */
  messages: EmailEnvelope[];
  self: { accountId: string; address: string; signatureHtml: string };
  /** Every address across the user's connected accounts (for reply-all pruning). */
  selfAddresses: string[];
};

/**
 * Build a reply / reply-all / forward draft off a thread. Threads correctly
 * (In-Reply-To = the newest message's Message-ID; References = its chain + itself),
 * and reply-all keeps the original recipients minus every address you own.
 */
export function buildComposeDraft(args: BuildArgs): ComposeDraft {
  const { mode, thread, messages, self, selfAddresses } = args;
  const selfSet = new Set(selfAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean));

  const anchor = messages.length ? messages[messages.length - 1] : undefined;
  // Reply to the newest message NOT from you (fallback: the anchor).
  const target =
    [...messages].reverse().find((m) => !selfSet.has(m.senderEmail.trim().toLowerCase())) ??
    anchor;

  const inReplyTo = anchor?.messageId ?? null;
  const references = uniq([...(anchor?.references ?? []), anchor?.messageId ?? ""]).slice(
    -MAX_REFERENCES,
  );

  let to: string[] = [];
  let cc: string[] = [];
  if (mode === "reply" || mode === "reply-all") {
    to = target?.senderEmail ? [target.senderEmail.toLowerCase()] : [];
    if (mode === "reply-all") {
      // Keep everyone on the original To AND Cc lines, minus every address I own
      // and the reply target (who's already in To).
      const others = uniq([
        ...splitAddresses(target?.to),
        ...splitAddresses(target?.cc),
      ]).filter((a) => !selfSet.has(a) && !to.includes(a));
      cc = others;
    }
  }

  const subject =
    mode === "forward" ? forwardSubject(thread.subject) : replySubject(thread.subject);

  return {
    mode,
    accountId: self.accountId,
    to: to.join(", "),
    cc: cc.join(", "),
    bcc: "",
    subject,
    bodyHtml: composeInitialBody(self.signatureHtml, quotedOriginal(anchor, mode)),
    inReplyTo,
    references,
    attachments: [],
  };
}

/** An empty "new message" draft from a chosen account. */
export function blankDraft(accountId: string, signatureHtml: string): ComposeDraft {
  return {
    mode: "new",
    accountId,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    bodyHtml: composeInitialBody(signatureHtml, ""),
    inReplyTo: null,
    references: [],
    attachments: [],
  };
}
