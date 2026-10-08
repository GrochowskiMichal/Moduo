/**
 * The building blocks every Moduo email is made of (specs/transactional-email.md
 * T4). A template returns an `EmailDoc` — plain data — and `render.ts` turns the
 * same doc into both the HTML and the plain-text version, so the two can never
 * drift apart.
 *
 * Text is plain strings. The renderer escapes every one of them; nothing in a
 * doc is ever interpreted as HTML. Emphasis comes only from the `fixed()` and
 * `strong()` markers below.
 */

/** A word in a booking sentence that reads like a filled-in blank (underlined). */
export type FixedText = { fixed: string };
/** Text that should stand out within a paragraph (an address, a name). */
export type StrongText = { strong: string };
export type Inline = string | FixedText | StrongText;

export type Block =
  /** The Moduo lockup image, top-left. */
  | { type: "lockup" }
  /** The host's face and name, top-left on guest booking emails (like the booking page). */
  | { type: "host"; name: string; avatarUrl?: string | null }
  /** A workspace's mark and name. */
  | { type: "workspace"; name: string }
  | { type: "heading"; text: string }
  /** The booking page's big light sentence. */
  | { type: "sentence"; parts: Inline[] }
  | { type: "paragraph"; parts: Inline[] }
  | { type: "muted"; parts: Inline[] }
  /** A sign-in code, shown like the app's code box. */
  | { type: "code"; code: string }
  /** The one call to action. An email has at most one. */
  | { type: "button"; label: string; href: string; caption?: string }
  | { type: "link"; label: string; href: string }
  /** Label/value pairs between two hairlines. */
  | { type: "rows"; rows: { label: string; value: string }[] }
  | { type: "list"; items: Inline[][] }
  | { type: "signoff"; text: string }
  /** Tells the reader a file is attached (the file itself goes on the send). */
  | { type: "attachment"; filename: string; label: string }
  | { type: "eyebrow"; text: string }
  /** A titled item, as in a build update. */
  | { type: "item"; title: string; body: string };

export type FooterLink = { label: string; href: string };

export type Footer = {
  /** One sentence: why this person got this email. */
  reason: string;
  /** Extra links before Privacy (Notification settings, Unsubscribe). */
  links?: FooterLink[];
  /** Guest booking emails carry "Scheduled with Moduo" (brand decision 73). */
  scheduledWith?: boolean;
};

export type EmailDoc = {
  subject: string;
  /** The grey line mail apps show after the subject. */
  preheader: string;
  blocks: Block[];
  footer: Footer;
};

export const fixed = (text: string): FixedText => ({ fixed: text });
export const strong = (text: string): StrongText => ({ strong: text });

export const lockup = (): Block => ({ type: "lockup" });
export const heading = (text: string): Block => ({ type: "heading", text });
export const sentence = (...parts: Inline[]): Block => ({ type: "sentence", parts });
export const paragraph = (...parts: Inline[]): Block => ({ type: "paragraph", parts });
export const muted = (...parts: Inline[]): Block => ({ type: "muted", parts });
export const codeBox = (code: string): Block => ({ type: "code", code });
export const button = (label: string, href: string, caption?: string): Block => ({
  type: "button",
  label,
  href,
  caption,
});
export const link = (label: string, href: string): Block => ({ type: "link", label, href });
export const signoff = (text: string): Block => ({ type: "signoff", text });

/** Flattens inline parts to plain text. */
export function inlineText(parts: Inline[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part : "fixed" in part ? part.fixed : part.strong))
    .join("");
}
