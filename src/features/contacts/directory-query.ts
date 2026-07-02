// Pure directory query logic (fix pack FX-3, AC4): widened search, status/tag
// filters, the A–Z ↔ Recent sort, and the "title · company" secondary line.
// The component owns state; this module owns the folding — unit-tested in
// directory-query.test.ts.

import type { TagLink } from "../tasks/model";
import type { Company, Contact } from "./model";

export type DirectorySort = "alpha" | "recent";

/** '' = no status filter. The sentinel "none" matches contacts with no status. */
export const STATUS_FILTER_NONE = "__none__";

function hay(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/** People search: name, every email/phone, title, company name. */
export function matchesPerson(c: Contact, q: string, companyName: string | null): boolean {
  if (!q) return true;
  return hay(
    c.name,
    c.email,
    ...c.emails.map((e) => e.value),
    c.title,
    companyName,
    c.phone,
    ...c.phones.map((p) => p.value),
  ).includes(q);
}

/** Company search: name, domains, website. */
export function matchesCompany(co: Company, q: string): boolean {
  if (!q) return true;
  return hay(co.name, co.domains.join(" "), co.website).includes(q);
}

/** The set of entity ids (of one type) carrying a tag. */
export function taggedEntityIds(links: TagLink[], tagId: string, entityType: string): Set<string> {
  const ids = new Set<string>();
  for (const l of links) {
    if (l.tagId === tagId && l.entityType === entityType) ids.add(l.entityId);
  }
  return ids;
}

export type PeopleFilter = {
  query: string;
  /** '' = all · STATUS_FILTER_NONE = no-status only · otherwise a status id. */
  status: string;
  /** '' = all · otherwise a tag id. */
  tagId: string;
  tagLinks: TagLink[];
  /** companyId → name, for company-name search + the secondary line. */
  companyNameById: Map<string, string>;
};

export function filterPeople(contacts: Contact[], f: PeopleFilter): Contact[] {
  const q = f.query.trim().toLowerCase();
  const tagged = f.tagId ? taggedEntityIds(f.tagLinks, f.tagId, "contact") : null;
  return contacts.filter((c) => {
    if (f.status === STATUS_FILTER_NONE && c.status) return false;
    if (f.status && f.status !== STATUS_FILTER_NONE && c.status !== f.status) return false;
    if (tagged && !tagged.has(c.id)) return false;
    return matchesPerson(c, q, c.companyId ? (f.companyNameById.get(c.companyId) ?? null) : null);
  });
}

export type CompanyFilter = {
  query: string;
  tagId: string;
  tagLinks: TagLink[];
};

export function filterCompanies(companies: Company[], f: CompanyFilter): Company[] {
  const q = f.query.trim().toLowerCase();
  const tagged = f.tagId ? taggedEntityIds(f.tagLinks, f.tagId, "company") : null;
  return companies.filter((co) => {
    if (tagged && !tagged.has(co.id)) return false;
    return matchesCompany(co, q);
  });
}

/**
 * Recent = most-recently-touched first (the cheap `updatedAt` proxy, the same
 * CO-5 decision); ties fall back to name so the order is stable.
 */
export function sortRecent<T extends { updatedAt: string; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

/** The directory row's secondary line: "title · company" when both exist. */
export function personSecondary(c: Contact, companyName: string | null): string | null {
  const parts = [c.title, companyName].filter(Boolean) as string[];
  if (parts.length > 0) return parts.join(" · ");
  return c.email ?? null;
}
