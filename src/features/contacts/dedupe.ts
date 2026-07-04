// Contacts module — duplicate detection. Wave 1, block CO-x.
//
// Pure, side-effect-free heuristics for surfacing likely-duplicate contacts in
// the directory ("Needs attention" widget / merge flow). Two signals, in order
// of confidence:
//   1. shared normalized email — strong; an email is a near-unique identity key.
//   2. shared normalized name  — weaker; only applied to contacts that the email
//      pass did not already cluster, so a person isn't flagged twice.
//
// No React, no I/O. Model types are type-only imports so this stays tree-shakeable
// and trivially unit-testable (vitest, no path-alias resolution needed).

import type { Contact } from "./model";

/**
 * A cluster of contacts judged likely to be the same person.
 * - `reason` — which signal grouped them (email is preferred over name).
 * - `key`    — the normalized value the group hangs off (the lowercased email or
 *   collapsed name); also the stable sort key for deterministic output.
 * - `contactIds` — the distinct member ids (>= 2), in first-seen order.
 */
export type DuplicateGroup = {
  reason: "email" | "name";
  key: string;
  contactIds: string[];
};

/** What the new-contact modal probes against the loaded directory (FX-6 AC9). */
export type ContactProbe = { email?: string | null; name?: string | null };

/** Lowercase + trim a single value; blanks normalize to "". */
function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Lowercase, trim, and collapse internal whitespace runs to one space. */
function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** All normalized, non-blank emails on a contact (scalar fast-path + channels). */
function contactEmails(contact: Contact): string[] {
  const raw = [contact.email, ...(contact.emails ?? []).map((c) => c.value)];
  const seen = new Set<string>();
  for (const value of raw) {
    const norm = normalizeEmail(value);
    if (norm) seen.add(norm);
  }
  return [...seen];
}

/**
 * Find likely-duplicate clusters across `contacts`.
 *
 * Pass 1 (email): union contacts that share any normalized email. Each resulting
 * cluster of >= 2 distinct ids becomes an `email` group, keyed by the
 * lexicographically smallest email in the cluster (stable + deterministic).
 *
 * Pass 2 (name): among contacts NOT already in an email cluster, group by
 * normalized name; clusters of >= 2 distinct ids become `name` groups.
 *
 * Output is sorted by `key`. Blank emails/names are ignored.
 */
export function findDuplicateGroups(contacts: Contact[]): DuplicateGroup[] {
  // --- Pass 1: email — union-find over contacts sharing an email. ---
  // parent[id] -> representative id in its connected component.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path-compress so repeated finds stay cheap.
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Seed every contact, then union all sharing a normalized email.
  const emailToFirstId = new Map<string, string>();
  for (const contact of contacts) {
    if (!parent.has(contact.id)) parent.set(contact.id, contact.id);
    for (const email of contactEmails(contact)) {
      const prior = emailToFirstId.get(email);
      if (prior === undefined) emailToFirstId.set(email, contact.id);
      else union(prior, contact.id);
    }
  }

  // Collect components, preserving first-seen member order. Track the smallest
  // email per component to use as the deterministic group key.
  const componentMembers = new Map<string, string[]>(); // root -> ids
  const componentEmails = new Map<string, string[]>(); // root -> emails
  for (const contact of contacts) {
    const emails = contactEmails(contact);
    if (emails.length === 0) continue; // no email signal — defer to name pass
    const root = find(contact.id);
    const members = componentMembers.get(root) ?? [];
    if (!members.includes(contact.id)) members.push(contact.id);
    componentMembers.set(root, members);
    const seenEmails = componentEmails.get(root) ?? [];
    for (const email of emails) if (!seenEmails.includes(email)) seenEmails.push(email);
    componentEmails.set(root, seenEmails);
  }

  const groups: DuplicateGroup[] = [];
  const groupedByEmail = new Set<string>(); // ids already claimed by an email group
  for (const [root, members] of componentMembers) {
    if (members.length < 2) continue; // need >= 2 distinct ids to be a duplicate
    const emails = componentEmails.get(root) ?? [];
    const key = [...emails].sort()[0]!; // smallest email = stable key
    groups.push({ reason: "email", key, contactIds: members });
    for (const id of members) groupedByEmail.add(id);
  }

  // --- Pass 2: name — only over contacts the email pass left untouched. ---
  const nameToIds = new Map<string, string[]>();
  for (const contact of contacts) {
    if (groupedByEmail.has(contact.id)) continue;
    const name = normalizeName(contact.name);
    if (!name) continue; // ignore blank names
    const ids = nameToIds.get(name) ?? [];
    if (!ids.includes(contact.id)) ids.push(contact.id);
    nameToIds.set(name, ids);
  }
  for (const [name, ids] of nameToIds) {
    if (ids.length < 2) continue;
    groups.push({ reason: "name", key: name, contactIds: ids });
  }

  // Deterministic output: sort by key (then reason as a tiebreak for stability).
  groups.sort((a, b) => (a.key === b.key ? a.reason.localeCompare(b.reason) : a.key < b.key ? -1 : 1));
  return groups;
}

/**
 * Probe a new-contact draft against the loaded directory and return the existing
 * contact it likely duplicates (the modal's "Looks like Jane Cooper — Open
 * instead?" warning, FX-6 AC9). An exact email match wins (case-insensitive,
 * scalar OR channel); else an exact normalized-name match. Returns null when the
 * draft has no signal or matches nobody — the warning is informational and never
 * blocks creation. Blank inputs never match.
 */
export function probeDuplicate(input: ContactProbe, contacts: Contact[]): Contact | null {
  const email = normalizeEmail(input.email);
  if (email) {
    const hit = contacts.find((c) => contactEmails(c).includes(email));
    if (hit) return hit;
  }
  const name = normalizeName(input.name);
  if (name) {
    const hit = contacts.find((c) => normalizeName(c.name) === name);
    if (hit) return hit;
  }
  return null;
}
