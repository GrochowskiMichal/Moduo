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
import type { HubSnippetMeta } from "../spine/snippet-projectors";
import type { ActivityEntry } from "../tasks/model";
import { computeLastTouch, lastTouchPhrase } from "./rollup";
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
  /** The company's own activity trail (module_activity for this company). */
  activity?: ActivityEntry[];
  /** Live per-entity meta for row snippets (task status/due, note touched-at…). */
  snippetMeta?: Map<string, HubSnippetMeta>;
  /** Reference "now" for relative snippet phrasing (deterministic in tests). */
  now?: Date;
};

export type CompanyRollup = {
  /** Members, name-sorted. */
  people: CompanyPerson[];
  /** The company's + its people's work, grouped into the fixed hub sections. */
  unionSections: HubSection[];
  /** Most-recent touch across the company + its people's linked work (ISO), or null. */
  lastTouchAt: string | null;
  /** The activity row behind the last touch (for a verb), or null if a bare link. */
  lastTouchActivity: ActivityEntry | null;
};

const SECTION_ORDER = HUB_SECTIONS.map((s) => s.key);

/**
 * Fold the company's links + its members' links into the People group and the
 * unioned work roll-up.
 */
export function buildCompanyRollup(input: CompanyRollupInput): CompanyRollup {
  const { company, companyLinks, members, memberLinks, records, snippetMeta, now } = input;
  const activity = input.activity ?? [];

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

  // `via` is the member whose links carried an inherited row (FX-7 "· via Jane
  // Cooper"); null for the company's own rows. First writer wins via `seen`, so a
  // row reachable from both the company and a member keeps the company's null.
  const fold = (focus: EntityRef, links: EntityLink[], via: string | null) => {
    for (const section of rollupSections(focus, links, records, { snippetMeta, now })) {
      for (const row of section.rows) {
        if (row.other.type === "company" && row.other.id === company.id) continue;
        if (row.other.type === "contact" && memberIds.has(row.other.id)) continue;
        const dedupeKey = `${section.key}|${entityRefKey(row.other)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const acc = merged.get(section.key) ?? { key: section.key, label: section.label, rows: [], count: 0 };
        acc.rows.push({ ...row, via });
        merged.set(section.key, acc);
      }
    }
  };

  fold(company, companyLinks, null);
  // Fold every person's work — denormalized members AND works-at-only people.
  for (const p of people) fold({ type: "contact", id: p.id }, memberLinks[p.id] ?? [], p.name);

  const unionSections = [...merged.values()]
    .map((s) => ({ ...s, count: s.rows.length }))
    .sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key));

  // Last touch across the company + its people's linked work: the company's own
  // activity, plus every link creation touching the company or a member (a link
  // made from the other side never lands in the company's activity). Like the
  // contact hub, this does NOT read edits on the linked entities themselves
  // (the CO-2 cross-entity deferral) — it is a linking/interaction recency.
  const linkStamps = [companyLinks, ...Object.values(memberLinks)].flatMap((ls) => ls.map((l) => l.createdAt));
  const { lastTouchAt, lastTouchActivity } = computeLastTouch(activity, linkStamps);

  return { people, unionSections, lastTouchAt, lastTouchActivity };
}

/**
 * The quiet one-liner under the company header: "Last touch: linked 3 days ago",
 * or "No activity yet" for a brand-new company. Mirrors the contact hub's
 * last-touch (minus the open-items counts the company hub doesn't compute).
 */
export function companyLastTouchLine(rollup: CompanyRollup, now: Date): string {
  return lastTouchPhrase(rollup.lastTouchAt, rollup.lastTouchActivity, now);
}
