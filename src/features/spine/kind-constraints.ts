// Connective-tissue spine — endpoint-pair relation-kind constraints (block FX-5).
//
// A pure, order-independent matrix: given two endpoint entity types, which of the
// closed {@link RelationKind} set actually make sense between them. The server's
// 8-kind set is untouched — this is a CLIENT guardrail so no gesture (the change-
// relation menu, a drag resolve, or a suggestion accept) can produce a nonsense
// edge like `attachment`/`paid-by`/`works-at` between two people (the observed
// "Ben Okafor · Attachment" bug, specs/contacts-v3-fixpack.md AC8).
//
// Runtime-free so it unit-tests cleanly (kind-constraints.test.ts). The matrix is
// deliberately permissive on the generic kinds (`references`, `mentions`) and
// narrow only where a kind carries a hard endpoint requirement.

import { DEFAULT_RELATION_KIND, RELATION_KINDS, type RelationKind } from "../../lib/entity-links";

// A project is linked as its `bucket` (RF-1: the registry checks it per item).
const WORK_TYPES = new Set(["task", "project", "bucket"]);
const MONEY_TYPES = new Set(["payment", "invoice"]);
const PARTY_TYPES = new Set(["contact", "company"]);
/** Types that can be "attached" to something (a file/email/receipt), never people. */
const ATTACHABLE_TYPES = new Set(["file", "email", "payment", "invoice"]);

const isWork = (t: string) => WORK_TYPES.has(t);
const isMoney = (t: string) => MONEY_TYPES.has(t);
const isParty = (t: string) => PARTY_TYPES.has(t);
const isAttachable = (t: string) => ATTACHABLE_TYPES.has(t);

/**
 * The relation kinds sensible between a pair of endpoint types, in the canonical
 * {@link RELATION_KINDS} order. Symmetric: `allowedKinds(a, b)` === `allowedKinds(b, a)`.
 *
 * - `references` — always (the generic default; any pair may just be "related").
 * - `mentions`   — always (a prose @mention can point at anything).
 * - `works-at`   — only contact↔company.
 * - `paid-by`    — only when one end is a payment/invoice and the other is a party.
 * - `attachment` — only when one end is attachable (file/email/receipt); never person↔person.
 * - `spawned-from` — when a work item or an email is involved (email→task, task→note).
 * - `blocks`     — only work↔work (a dependency edge between tasks/projects).
 * - `follow-up`  — when a work item is involved (a follow-up task owed on an entity).
 */
export function allowedKinds(a: string, b: string): RelationKind[] {
  const pairIs = (x: string, y: string) => (a === x && b === y) || (a === y && b === x);

  const allowed = new Set<RelationKind>([DEFAULT_RELATION_KIND, "mentions"]);
  if (pairIs("contact", "company")) allowed.add("works-at");
  if ((isMoney(a) && isParty(b)) || (isMoney(b) && isParty(a))) allowed.add("paid-by");
  if (isAttachable(a) || isAttachable(b)) allowed.add("attachment");
  if (a === "email" || b === "email" || isWork(a) || isWork(b)) allowed.add("spawned-from");
  if (isWork(a) && isWork(b)) allowed.add("blocks");
  if (isWork(a) || isWork(b)) allowed.add("follow-up");

  return RELATION_KINDS.filter((k) => allowed.has(k));
}

/** Whether `kind` is a sensible relation between the two endpoint types. */
export function isKindAllowed(kind: RelationKind, a: string, b: string): boolean {
  return allowedKinds(a, b).includes(kind);
}

/**
 * Coerce a proposed kind to one sensible for the pair: keep it if allowed, else
 * fall back to `references`. Used at every write seam (drag resolve, suggestion
 * accept) so a bad suggested/derived kind can never persist a nonsense edge.
 */
export function coerceKindForPair(kind: RelationKind, a: string, b: string): RelationKind {
  return isKindAllowed(kind, a, b) ? kind : DEFAULT_RELATION_KIND;
}
