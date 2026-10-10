// Connective-tissue spine — the @mention / /ref resolver (block CT-4).
//
// The pure brain behind both link-from-text gestures: typing `@` to mention an
// entity or a person, and `/ref` (`/task` `/note` `/contact`) to insert a live
// ref while writing. Given the trigger and the picked candidate, it decides
// exactly what to do — write a `mentions` link, write a `references` link,
// target a person with a notification, or create-and-link a brand-new entity —
// with no React, no runtime, no Lexical. Both the inline `@` plugin and the
// slash `/ref` plugin funnel their selection through `resolveMention`; the
// UI/runtime halves only *execute* the returned plan. Mirrors entity-links.ts.

import type { EntityRef, LinkOrigin, RelationKind } from "@/lib/entity-links";
import type { DateCommand, DateCommandId } from "./grammar";

/**
 * Which text gesture opened the picker (the grammar, spine/grammar.ts): `@` →
 * a mention; `/` → a command or a typed ref; `#` → a tag.
 */
export type MentionTrigger = "mention" | "ref" | "tag";

/** A pickable entity already in the registry (the common case). */
export type MentionEntityCandidate = {
  kind: "entity";
  /** The entity to link to. */
  ref: EntityRef;
  label: string;
  icon: string | null;
};

/** A pickable workspace member — a person, not a registry entity. */
export type MentionPersonCandidate = {
  kind: "person";
  /** The member's user id — the notification target. */
  memberId: string;
  label: string;
  icon: string | null;
};

/** A "no match — create it" candidate, offered for a typed `/ref` + query. */
export type MentionCreateCandidate = {
  kind: "create";
  /** The entity type to create (e.g. "task"). */
  entityType: string;
  /** The typed text to use as the new entity's label. */
  label: string;
};

/** A `/` date command (`/today`, `/tomorrow`, `/next week`, `/date`). */
export type MentionCommandCandidate = {
  kind: "command";
  command: DateCommandId;
  label: string;
};

/** A workspace tag, for `#` in prose (a link to the tag, never applying it). */
export type MentionTagCandidate = {
  kind: "tag";
  tagId: string;
  label: string;
  color: string | null;
};

export type MentionCandidate =
  | MentionEntityCandidate
  | MentionPersonCandidate
  | MentionCreateCandidate
  | MentionCommandCandidate
  | MentionTagCandidate;

/** Link an existing entity (entity `@mention` or `/ref`). */
export type LinkMentionResolution = {
  action: "link";
  target: EntityRef;
  relationKind: RelationKind;
  origin: LinkOrigin;
  /** Registry label/icon to seed on the link (so the chip renders immediately). */
  label: string;
  icon: string | null;
};

/** A person mention — target a member with a notification (no entity link). */
export type NotifyPersonResolution = {
  action: "notify-person";
  memberId: string;
  label: string;
};

/** No match: create the entity, then link it (one action). */
export type CreateAndLinkResolution = {
  action: "create-and-link";
  entityType: string;
  label: string;
  relationKind: RelationKind;
  origin: LinkOrigin;
};

/** A `/` date command: insert a date chip (or open the picker for `/date`). */
export type InsertDateResolution = { action: "insert-date"; command: DateCommandId };

/** `#tag` in prose: insert a link to the tag (its tags field is never changed). */
export type InsertTagResolution = { action: "insert-tag"; tagId: string; label: string };

export type MentionResolution =
  | LinkMentionResolution
  | NotifyPersonResolution
  | CreateAndLinkResolution
  | InsertDateResolution
  | InsertTagResolution;

/** The relation kind a trigger implies: `@` → `mentions`, `/ref` → `references`. */
export function relationKindForTrigger(trigger: MentionTrigger): RelationKind {
  return trigger === "mention" ? "mentions" : "references";
}

/** The link origin a trigger stamps: `@` → `mention`, `/ref` → `ref`. */
export function originForTrigger(trigger: MentionTrigger): LinkOrigin {
  return trigger === "mention" ? "mention" : "ref";
}

/**
 * Decide what a picked candidate should do, given the gesture that opened the
 * picker. The single branch point shared by the `@` and `/ref` surfaces:
 *
 * - **entity** → link it (`mentions` for `@`, `references` for `/ref`).
 * - **person** → target them with a notification (people aren't registry
 *   entities, so no link is written — the activity row is the connection).
 * - **create** → create the entity, then link it, carrying the trigger's
 *   kind/origin (the `/task Foo` no-match path).
 */
export function resolveMention(input: {
  trigger: MentionTrigger;
  candidate: MentionCandidate;
}): MentionResolution {
  const { trigger, candidate } = input;
  switch (candidate.kind) {
    case "entity":
      return {
        action: "link",
        target: candidate.ref,
        relationKind: relationKindForTrigger(trigger),
        origin: originForTrigger(trigger),
        label: candidate.label,
        icon: candidate.icon,
      };
    case "person":
      return {
        action: "notify-person",
        memberId: candidate.memberId,
        label: candidate.label,
      };
    case "create":
      return {
        action: "create-and-link",
        entityType: candidate.entityType,
        label: candidate.label,
        relationKind: relationKindForTrigger(trigger),
        origin: originForTrigger(trigger),
      };
    case "command":
      return { action: "insert-date", command: candidate.command };
    case "tag":
      return { action: "insert-tag", tagId: candidate.tagId, label: candidate.label };
  }
}

/** A registry record as the picker consumes it (subset of `EntityRecord`). */
export type SearchedEntity = {
  type: string;
  id: string;
  label: string;
  icon: string | null;
};

/** A workspace member as the picker consumes it. */
export type SearchedPerson = {
  memberId: string;
  label: string;
  icon?: string | null;
};

/** A tag as the `#` picker consumes it. */
export type SearchedTag = { id: string; name: string; color: string | null };

/**
 * A project as a pickable thing. Its registry type is `bucket` (the table it
 * lives in): the registry's read policy checks `bucket` per item, while an
 * unknown type such as `project` falls back to module-level access and would
 * show a private project's name to every member once a link registered it.
 */
export function projectAsEntity(row: { id: string; name: string }): SearchedEntity {
  return { type: "bucket", id: row.id, label: row.name, icon: "project" };
}

/**
 * Assemble the ordered candidate list a picker shows, from a registry search +
 * (for `@`) workspace members + an optional "create" affordance. Pure so the
 * picker's branching is unit-testable without a runtime. The order follows the
 * grammar (call 33): people first, then projects, then other things.
 *
 * - **`/` date commands come first** when offered (33a);
 * - **people are only offered for the `@` trigger** (a `/ref` is entity-scoped);
 * - **projects** come before the other things;
 * - a **"Create …"** item is appended only for a `/ref` with a non-empty query,
 *   a wired creator (`canCreate`), and **no exact-label match** already present;
 * - **`#`** lists tags only.
 */
export function buildMentionCandidates(input: {
  trigger: MentionTrigger;
  query: string;
  entities: SearchedEntity[];
  /** People are only offered for the `@` (mention) trigger. */
  people?: SearchedPerson[];
  /** Projects, listed before other things. */
  projects?: SearchedEntity[];
  /** The `/` date commands matching the query (`matchDateCommands`). */
  commands?: readonly DateCommand[];
  /** Tags, for the `#` trigger. */
  tags?: SearchedTag[];
  /** The entity type a typed `/ref` creates on no-match (e.g. "task"). */
  createType?: string | null;
  /** Whether a creator is wired for `createType` (gates the "Create…" item). */
  canCreate?: boolean;
  /**
   * Prose: create only behind the type's word (`/task Order frames`), so `/`
   * in a sentence ("copy it to /tmp then") can never make something on Enter.
   */
  createNoun?: boolean;
}): MentionCandidate[] {
  const {
    trigger,
    query,
    entities,
    people,
    projects,
    commands,
    tags,
    createType,
    canCreate,
    createNoun,
  } = input;
  const candidates: MentionCandidate[] = [];

  if (trigger === "tag") {
    for (const t of tags ?? []) {
      candidates.push({ kind: "tag", tagId: t.id, label: t.name, color: t.color });
    }
    return candidates;
  }

  if (trigger === "ref" && commands) {
    for (const c of commands) candidates.push({ kind: "command", command: c.id, label: c.label });
  }

  if (trigger === "mention" && people) {
    for (const p of people) {
      candidates.push({
        kind: "person",
        memberId: p.memberId,
        label: p.label,
        icon: p.icon ?? null,
      });
    }
  }

  const things = [...(projects ?? []), ...entities];
  for (const e of things) {
    candidates.push({
      kind: "entity",
      ref: { type: e.type, id: e.id },
      label: e.label,
      icon: e.icon,
    });
  }

  const trimmed = query.trim();
  let createLabel = trimmed;
  if (createNoun && createType) {
    const lower = trimmed.toLowerCase();
    const noun = `${createType.toLowerCase()} `;
    createLabel = lower.startsWith(noun) ? trimmed.slice(noun.length).trim() : "";
  }
  const hasExact = things.some((e) => e.label.trim().toLowerCase() === createLabel.toLowerCase());
  if (trigger === "ref" && canCreate && createType && createLabel.length > 0 && !hasExact) {
    candidates.push({ kind: "create", entityType: createType, label: createLabel });
  }

  return candidates;
}
