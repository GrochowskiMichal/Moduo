// Connective-tissue spine — the "Recently linked" projection (block CT-7, AC12).
//
// The pure shaper behind the dashboard widget: it joins recent `entity_links`
// rows to the registry records for both endpoints, so each row reads as
// "<source> → <target> · <kind>" with resolved labels/icons and tombstone flags.
// Pure + deterministic; the runtime does the two reads (links + a batched
// registry lookup) and hands them here.

import type { EntityLink, EntityRecord, LinkOrigin, RelationKind } from "../../lib/entity-links";

/** One endpoint of a recent link, label/icon resolved from the registry. */
export type RecentLinkEndpoint = {
  type: string;
  id: string;
  label: string;
  icon: string | null;
  tombstoned: boolean;
};

/** A recent link, ready for the dashboard widget (both ends resolved). */
export type RecentLinkItem = {
  id: string;
  relationKind: RelationKind;
  origin: LinkOrigin;
  createdAt: string;
  source: RecentLinkEndpoint;
  target: RecentLinkEndpoint;
};

function refKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function endpoint(type: string, id: string, byKey: Map<string, EntityRecord>): RecentLinkEndpoint {
  const rec = byKey.get(refKey(type, id));
  return {
    type,
    id,
    // Fall back to the type when a registry label is missing/empty, never blank.
    label: rec?.label && rec.label.trim() ? rec.label : type,
    icon: rec?.icon ?? null,
    tombstoned: Boolean(rec?.deletedAt),
  };
}

/**
 * Project recent links into widget rows, newest first. `byKey` maps
 * `${type}:${id}` → the registry record for both endpoints (a missing record
 * degrades to a type-labelled, non-tombstoned endpoint rather than dropping the
 * row, so a not-yet-registered entity still shows).
 */
export function shapeRecentLinks(
  links: EntityLink[],
  byKey: Map<string, EntityRecord>,
): RecentLinkItem[] {
  return links
    .map((link) => ({
      id: link.id,
      relationKind: link.relationKind,
      origin: link.origin,
      createdAt: link.createdAt,
      source: endpoint(link.sourceType, link.sourceId, byKey),
      target: endpoint(link.targetType, link.targetId, byKey),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
