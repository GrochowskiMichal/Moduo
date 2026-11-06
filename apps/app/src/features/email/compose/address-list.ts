// The recipient fields' string form (specs/mail-v3.md §9): a compose keeps To,
// Cc and Bcc as comma-joined entries, each a bare address or "Name <address>".
// The token input reads and writes that form; names never carry a comma, so a
// comma always separates entries.

import { addressEmail } from "../compose";

/** The entries of a recipient field, trimmed, empty ones dropped. */
export function splitEntries(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinEntries(entries: readonly string[]): string {
  return entries.join(", ");
}

/** "Ana Lima <ana@x.test>", or the bare address without a name. */
export function personEntry(p: { name: string; email: string }): string {
  const name = p.name
    .replace(/[,"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name ? `${name} <${p.email}>` : p.email;
}

/** What a token shows: the entry's name, else its address. */
export function entryLabel(entry: string): string {
  const m = entry.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return m?.[1]?.trim() || (m ? m[2]!.trim() : entry.trim());
}

/** Adds an entry unless that address is already there. */
export function addEntry(raw: string, entry: string): string {
  const list = splitEntries(raw);
  const email = addressEmail(entry) || entry.trim().toLowerCase();
  if (list.some((e) => (addressEmail(e) || e.toLowerCase()) === email)) return raw;
  return joinEntries([...list, entry.trim()]);
}

export function removeEntryAt(raw: string, index: number): string {
  return joinEntries(splitEntries(raw).filter((_, i) => i !== index));
}
