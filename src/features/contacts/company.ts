// Company → people union (block CO-4, specs/contacts.md AC8). A company hub shows
// its PEOPLE (members via the denormalized company_id AND the canonical `works-at`
// link) plus the UNION of those people's linked work rolled up one level higher —
// e.g. a task linked to an employee surfaces on the company. Pure + runtime-free
// so it unit-tests (company.test.ts); the live reads (company links, each member's
// links, the registry projection) live in use-company-hub.
//
// The union reuses the spine's tested `rollupSections` per member, then merges the
// sections, dedupes by endpoint, and drops the intra-company edges (a person↔the
// company, a person↔a fellow member) — those are the People group, not "work".

import type { EntityLink, EntityRecord, EntityRef } from "../../lib/entity-links";
import { entityRefKey, HUB_SECTIONS, otherEndpoint, rollupSections, type HubSection } from "../spine/rollup";
import type { Contact } from "./model";

/** A member shown in the company's People group. */
export type CompanyPerson = {
  id: string;
  name: string;
  /** Status of a denormalized member; "" for a works-at-only person (status unknown). */
  status: string;
  avatarUrl: string | null;
};

export type CompanyRollupInput = {
  company: EntityRef;
  /** Live links touching the company (from one indexed read). */
  companyLinks: EntityLink[];
  /** Contacts whose denormalized company_id is this company. */
  members: Contact[];
  /** contactId → that member's live links (one indexed read each). */
  memberLinks: Record<string, EntityLink[]>;
  /** Registry projection for every union endpoint, keyed by `type:id`. */
  records: Map<string, EntityRecord>;
};

export type CompanyRollup = {
  /** Members, name-sorted. */
  people: CompanyPerson[];
  /** The company's + its people's work, grouped into the fixed hub sections. */
  unionSections: HubSection[];
};

const SECTION_ORDER = HUB_SECTIONS.map((s) => s.key);

/**
 * Fold the company's links + its members' links into the People group and the
 * unioned work roll-up.
 */
export function buildCompanyRollup(input: CompanyRollupInput): CompanyRollup {
  const { company, companyLinks, members, memberLinks, records } = input;

  // ── People: denormalized members ∪ works-at-linked contacts ─────────────────
  const peopleById = new Map<string, CompanyPerson>();
  for (const m of members) {
    peopleById.set(m.id, { id: m.id, name: m.name || "Unnamed", status: m.status, avatarUrl: m.avatarUrl });
  }
  for (const link of companyLinks) {
    if (link.relationKind !== "works-at") continue;
    const other = otherEndpoint(company, link);
    if (!other || other.type !== "contact" || peopleById.has(other.id)) continue;
    const rec = records.get(entityRefKey(other));
    peopleById.set(other.id, { id: other.id, name: rec?.label || "Unnamed", status: "", avatarUrl: null });
  }
  const people = [...peopleById.values()].sort((a, b) => a.name.localeCompare(b.name));
  const memberIds = new Set(people.map((p) => p.id));

  // ── Union: the company's own work + each member's work, one level up ─────────
  // Reuse the tested per-entity rollup; merge sections; dedupe by endpoint; drop
  // intra-company edges (the People group already covers person↔company/person).
  const merged = new Map<string, HubSection>();
  const seen = new Set<string>();

  const fold = (focus: EntityRef, links: EntityLink[]) => {
    for (const section of rollupSections(focus, links, records)) {
      for (const row of section.rows) {
        if (row.other.type === "company" && row.other.id === company.id) continue;
        if (row.other.type === "contact" && memberIds.has(row.other.id)) continue;
        const dedupeKey = `${section.key}|${entityRefKey(row.other)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const acc = merged.get(section.key) ?? { key: section.key, label: section.label, rows: [], count: 0 };
        acc.rows.push(row);
        merged.set(section.key, acc);
      }
    }
  };

  fold(company, companyLinks);
  // Fold every person's work — denormalized members AND works-at-only people.
  for (const p of people) fold({ type: "contact", id: p.id }, memberLinks[p.id] ?? []);

  const unionSections = [...merged.values()]
    .map((s) => ({ ...s, count: s.rows.length }))
    .sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key));

  return { people, unionSections };
}
