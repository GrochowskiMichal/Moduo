// Connective-tissue spine — the link substrate (block CT-1).
//
// The pure-TS half of the keystone: the canonical `relation_kind` / `origin`
// sets, the entity/link model types, the closed-set validator, and the
// direction-agnostic dedupe key. Mirrors the Supabase shape defined in
// supabase/migrations/20260625120000_spine_entity_links.sql and the canonical
// data sketch in .design/connective-tissue/DESIGN_BRIEF.md §Data.
//
// Entity addressing is polymorphic: an entity is a `(type, id)` pair. `type` is
// an open string (like TagLink.entityType) so new modules participate without a
// code change — but the well-known set is enumerated below for the picker/search.

/**
 * The closed set of link relation kinds, shared by every module (no
 * user-defined relations at alpha — the Anytype guardrail). The kind drives hub
 * grouping and roll-up phrasing. Hyphenated tokens are the wire format. Adding a
 * kind is a schema change (a migration), never a runtime/user action.
 */
export const RELATION_KINDS = [
  "references", // default — a gesture that implies no stronger kind
  "spawned-from", // this was created out of that (email → task, task → note)
  "blocks", // dependency edge (blocker → blocked); Tasks' blocked-by rides this
  "attachment", // a file/email/payment attached to an entity
  "mentions", // an @mention of an entity inside prose
  "works-at", // person → company
  "follow-up", // a follow-up owed on an entity
  "paid-by", // an invoice/payment → the contact who paid it
] as const;

export type RelationKind = (typeof RELATION_KINDS)[number];

/** The default kind when a gesture implies no stronger relationship. */
export const DEFAULT_RELATION_KIND: RelationKind = "references";

/** Sentence-case display labels for each relation kind (hub meta, kind picker). */
export const RELATION_KIND_LABELS: Record<RelationKind, string> = {
  references: "References",
  "spawned-from": "Spawned from",
  blocks: "Blocks",
  attachment: "Attachment",
  mentions: "Mentions",
  "works-at": "Works at",
  "follow-up": "Follow-up",
  "paid-by": "Paid by",
};

/**
 * How a link came to exist — used for trust signals and dedupe. `manual` is the
 * default; `drag` / `mention` / `ref` / `suggest` record the originating gesture.
 */
export const LINK_ORIGINS = ["manual", "drag", "mention", "ref", "suggest"] as const;

export type LinkOrigin = (typeof LINK_ORIGINS)[number];

/** The default origin when no originating gesture is recorded. */
export const DEFAULT_LINK_ORIGIN: LinkOrigin = "manual";

/**
 * Well-known entity types. Polymorphic `entity_type` stays an open string (so a
 * new module needs no change here), but these are the alpha-known types used to
 * scope the search / @mention picker and to resolve a default type icon.
 */
export const KNOWN_ENTITY_TYPES = [
  "task",
  "contact",
  "company",
  "note",
  "email",
  "event",
  "payment",
  "project",
  "file",
] as const;

/** A polymorphic entity address. `type` is open by design (see above). */
export type EntityType = string;

/** A reference to any entity in the spine: a `(type, id)` pair. */
export type EntityRef = {
  type: EntityType;
  id: string;
};

/**
 * A row from the central `entities` registry — the denormalized projection that
 * powers search, the @mention/`/ref` picker, and roll-up label resolution.
 */
export type EntityRecord = {
  workspaceId: string;
  type: EntityType;
  id: string;
  label: string;
  icon: string | null;
  deletedAt: string | null;
};

/**
 * A typed, polymorphic link between two entities — THE keystone. Direction is
 * preserved in source/target; uniqueness (see {@link deriveLinkKey}) is
 * direction-agnostic.
 */
export type EntityLink = {
  id: string;
  workspaceId: string;
  sourceType: EntityType;
  sourceId: string;
  targetType: EntityType;
  targetId: string;
  relationKind: RelationKind;
  origin: LinkOrigin;
  createdBy: string | null;
  createdAt: string;
  deletedAt: string | null;
};

/** Type guard: is `value` one of the closed relation kinds? */
export function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === "string" && (RELATION_KINDS as readonly string[]).includes(value);
}

/** Type guard: is `value` one of the closed link origins? */
export function isLinkOrigin(value: unknown): value is LinkOrigin {
  return typeof value === "string" && (LINK_ORIGINS as readonly string[]).includes(value);
}

/**
 * Normalize an arbitrary kind input to a valid {@link RelationKind}, falling
 * back to the default. Use at the boundary when a kind may be untrusted; use
 * {@link isRelationKind} when an invalid kind should be rejected instead.
 */
export function coerceRelationKind(value: unknown): RelationKind {
  return isRelationKind(value) ? value : DEFAULT_RELATION_KIND;
}

/** Are two entity refs the same entity? (A self-link target.) */
export function isSameEntity(a: EntityRef, b: EntityRef): boolean {
  return a.type === b.type && a.id === b.id;
}

/** A self-link is two refs pointing at the same entity — always rejected. */
export function isSelfLink(a: EntityRef, b: EntityRef): boolean {
  return isSameEntity(a, b);
}

/** Stable token for one endpoint, matching the SQL `type || ':' || id`. */
function endpointToken(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

/**
 * Direction-agnostic dedupe key for an unordered entity pair — the TS mirror of
 * the `pair_key` generated column (least/greatest of the two `type:id` tokens).
 * Identical regardless of which ref is passed first, so `(a,b)` and `(b,a)`
 * collapse to one link. Combine with a {@link RelationKind} for the full
 * uniqueness key (one live link per workspace, unordered pair, kind).
 */
export function deriveLinkKey(a: EntityRef, b: EntityRef): string {
  const ta = endpointToken(a);
  const tb = endpointToken(b);
  const [lo, hi] = ta <= tb ? [ta, tb] : [tb, ta];
  return `${lo}|${hi}`;
}

/** The full direction-agnostic uniqueness key: unordered pair + relation kind. */
export function deriveLinkUniquenessKey(a: EntityRef, b: EntityRef, kind: RelationKind): string {
  return `${deriveLinkKey(a, b)}#${kind}`;
}
