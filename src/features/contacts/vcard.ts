// Contact → vCard 4.0 export (RFC 6350). The inverse of the CSV importer's
// shape: a portable, single-contact interchange format that any address book
// (Apple Contacts, Google, Outlook) ingests. Pure + runtime-free so it
// unit-tests (vcard.test.ts); the page wires the download / clipboard.
//
// We emit a deliberately small subset — FN/N, ORG, TITLE, the repeatable
// EMAIL/TEL/ADR/URL channels, and BDAY — mirroring the thin contact record.
// Company name is passed in (not on the Contact) because the canonical edge is
// the `works-at` link; the caller resolves companyId → name.

import type { Contact } from "./model";

/** vCard line terminator (RFC 6350 §3.2 — folding/CRLF). */
const CRLF = "\r\n";

/**
 * Escape a vCard TEXT value: backslash first, then comma / semicolon / newline
 * (RFC 6350 §3.4). Order matters — escaping the backslash last would
 * double-escape the slashes we just added.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Escape a TYPE parameter value. Parameter values are quoted (`TYPE="work"`),
 * so the only character we must neutralize inside the quotes is the double
 * quote itself; we drop it rather than emit an invalid param.
 */
function escapeParam(value: string): string {
  return value.replace(/"/g, "");
}

/** A repeatable typed property: `NAME;TYPE="<label>":<escaped value>`. */
function typedLine(name: string, label: string, value: string): string {
  return `${name};TYPE="${escapeParam(label)}":${escapeText(value)}`;
}

/**
 * Best-effort N (structured name): `Family;Given;;;`. We split on the LAST
 * space so "Mary Anne Smith" → given "Mary Anne", family "Smith"; a single
 * token is treated as the given name (no family).
 */
function structuredName(name: string): string {
  const trimmed = name.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  const given = lastSpace === -1 ? trimmed : trimmed.slice(0, lastSpace);
  const family = lastSpace === -1 ? "" : trimmed.slice(lastSpace + 1);
  return `${escapeText(family)};${escapeText(given)};;;`;
}

/** Find the contact's birthday entry (special label 'birthday'), if present. */
function birthday(c: Contact): string | null {
  const entry = c.dates.find((d) => d.label === "birthday" && d.value.trim());
  return entry ? entry.value : null;
}

/** `YYYY-MM-DD` → `YYYYMMDD` (the BDAY date form, RFC 6350 §4.3.4). */
function bdayValue(value: string): string {
  return value.replace(/-/g, "");
}

/**
 * Serialize one contact as a vCard 4.0 card (BEGIN…END inclusive). Empty fields
 * are skipped; `opts.companyName` supplies ORG (the Contact carries only a FK).
 */
export function contactToVCard(c: Contact, opts?: { companyName?: string | null }): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:4.0"];

  // Identity: FN is required; N is a best-effort structured split.
  const name = c.name.trim();
  lines.push(`FN:${escapeText(name)}`);
  if (name) lines.push(`N:${structuredName(name)}`);

  // Organization + role.
  const org = opts?.companyName?.trim();
  if (org) lines.push(`ORG:${escapeText(org)}`);
  if (c.title?.trim()) lines.push(`TITLE:${escapeText(c.title)}`);

  // Repeatable typed channels — skip blank values.
  for (const e of c.emails) if (e.value.trim()) lines.push(typedLine("EMAIL", e.label, e.value));
  for (const p of c.phones) if (p.value.trim()) lines.push(typedLine("TEL", p.label, p.value));
  // ADR is a 7-component value; we pack the freeform address into the street
  // slot and leave the rest empty: `;;<street>;;;;`.
  for (const a of c.addresses) {
    if (a.value.trim())
      lines.push(`ADR;TYPE="${escapeParam(a.label)}":;;${escapeText(a.value)};;;;`);
  }
  for (const u of c.urls) if (u.value.trim()) lines.push(typedLine("URL", u.label, u.value));

  // Birthday (the one special date label).
  const bday = birthday(c);
  if (bday) lines.push(`BDAY:${bdayValue(bday)}`);

  lines.push("END:VCARD");
  return lines.join(CRLF);
}

/**
 * Serialize many contacts into one concatenated vCard document — the bulk
 * export. `companyNames` resolves each contact's `companyId` → ORG name (the
 * caller owns the company read); a missing/absent FK yields a card with no ORG.
 * Cards are joined with CRLF so the file is a clean stream of BEGIN…END blocks.
 */
export function contactsToVCard(cs: Contact[], companyNames?: Map<string, string>): string {
  return cs
    .map((c) =>
      contactToVCard(c, {
        companyName: c.companyId ? (companyNames?.get(c.companyId) ?? null) : null,
      }),
    )
    .join(CRLF);
}
