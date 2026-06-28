// "Paste a contact" — best-effort parse of a free-text blob / email signature
// into the fields the add-contact form pre-fills (specs/contacts-v2.md, the
// quick-add affordance). PURE: deterministic, no I/O, no React. The caller maps
// the result onto a {@link Contact}; everything here is optional and forgiving —
// a bad guess is a pre-fill the user edits, never a hard failure.

import type { Contact } from "./model";

/**
 * The shallow parse result. Lists are deduped and order-preserving; scalars are
 * null when nothing plausible was found. The shape is intentionally flatter than
 * {@link Contact} — the form widens emails/phones into {@link Contact.emails} /
 * {@link Contact.phones} and resolves `company` to a {@link Contact.companyId}.
 */
export type ParsedContactInput = {
  name: string | null;
  emails: string[];
  phones: string[];
  title: string | null;
  company: string | null;
};

// Robust-enough email matcher: local@domain.tld, tolerating +tags, dots, and
// subdomains. Deliberately not RFC-complete — we want signature realism, not a
// validator. Global so a blob with several addresses yields all of them.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Bare URL / domain token (with or without scheme). Used only to reject a line
// from name consideration, never extracted as a value.
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9-]+\.(?:com|org|net|io|co|dev|app|ai|xyz|me|us|uk)\b/i;

// A phone-like token: a run of digits and the usual separators, with a leading
// '+' allowed. We accept it only after counting >= 7 actual digits (below).
const PHONE_TOKEN_RE = /\+?\(?\d[\d\s().-]{5,}\d/g;

// Connectives that separate a job title from a company on a single signature
// line, in match priority. ' at ' is whitespace-padded so it never eats the "at"
// inside "Stat Analyst"; the punctuation/dash variants stand alone.
const TITLE_COMPANY_SPLITTERS = [" at ", " — ", " – ", " | ", " · ", ", "];

/** Count the digits in a token — the gate for "is this actually a phone?". */
function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n++;
  return n;
}

/** A line is "channel-ish" (email/phone/url) and so never a person's name. */
function looksLikeChannel(line: string): boolean {
  if (EMAIL_RE.test(line)) {
    EMAIL_RE.lastIndex = 0; // reset the stateful global regex after .test
    return true;
  }
  if (URL_RE.test(line)) return true;
  // A line that is mostly digits/separators is a phone, not a name.
  return digitCount(line) >= 7 && /^[+\d\s().-]+$/.test(line.trim());
}

/**
 * Heuristic: does this line read like a person's name? Short (<= 5 words), free
 * of channel markers and obvious title/company connectives. Email-signature
 * first lines are usually the name, so we keep the bar low and let the user fix.
 */
function looksLikeName(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (looksLikeChannel(t)) return false;
  if (t.includes("@") || t.includes("://")) return false;
  // Sign-offs end in a comma ("Best," / "Thanks,") — common signature noise.
  if (t.endsWith(",")) return false;
  const words = t.split(/\s+/);
  if (words.length === 0 || words.length > 5) return false;
  // Reject lines that read as a "Title at Company" role rather than a name.
  if (/\sat\s/i.test(t)) return false;
  return true;
}

/**
 * Pull a best-effort title/company pair from a single line like
 * "Head of Ops at Acme" / "Designer, Foo" / "PM | Bar" / "Lead — Baz".
 * Returns nulls when the line has no recognised splitter.
 */
function splitTitleCompany(line: string): { title: string | null; company: string | null } {
  const t = line.trim();
  for (const sep of TITLE_COMPANY_SPLITTERS) {
    const idx = t.indexOf(sep);
    if (idx > 0) {
      const title = t.slice(0, idx).trim();
      const company = t.slice(idx + sep.length).trim();
      if (title && company) return { title, company };
    }
  }
  return { title: null, company: null };
}

/** Dedup a list of strings, preserving first-seen order. */
function dedup(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Parse a pasted blob / email signature into a {@link ParsedContactInput}.
 * Defensive throughout — empty or junk input yields all-empty/null, never throws.
 *
 * - emails: all matches, lowercased + deduped.
 * - phones: tokens with >= 7 digits, deduped (original formatting kept).
 * - name: first non-empty line that is not a channel and reads like a name.
 * - title/company: best-effort from the first line carrying a known splitter.
 */
export function parseContactText(text: string): ParsedContactInput {
  const empty: ParsedContactInput = { name: null, emails: [], phones: [], title: null, company: null };
  if (typeof text !== "string" || !text.trim()) return empty;

  // Emails — run the global matcher over the whole blob, then normalise.
  const emails = dedup((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()));

  // Phones — candidate tokens gated by an actual >= 7 digit count, so dates and
  // long numbers in prose don't masquerade as phone numbers.
  const phones = dedup(
    (text.match(PHONE_TOKEN_RE) ?? []).map((p) => p.trim()).filter((p) => digitCount(p) >= 7),
  );

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Name — first line that survives the channel/name heuristics.
  let name: string | null = null;
  for (const line of lines) {
    if (looksLikeName(line)) {
      name = line;
      break;
    }
  }

  // Title / company — first line that yields a clean split, skipping the chosen
  // name line so "Jane Doe" alone never gets parsed as a role.
  let title: string | null = null;
  let company: string | null = null;
  for (const line of lines) {
    if (line === name) continue;
    if (looksLikeChannel(line)) continue;
    const split = splitTitleCompany(line);
    if (split.title && split.company) {
      title = split.title;
      company = split.company;
      break;
    }
  }

  return { name, emails, phones, title, company };
}

// Re-export the model type used at the call site, so consumers can import the
// parser and the target shape from one place without a second import line.
export type { Contact };
