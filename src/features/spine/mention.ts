// Connective-tissue spine — the @mention / /ref resolver (block CT-4).
//
// The pure, runtime-free heart of AC8: given the trigger (@ vs /ref) and the
// item the user picked, decide what to do —
//   • link an entity  (kind=mentions for @, references for /ref),
//   • notify a person (a person-targeted activity row; the write lands in CT-5),
//   • or create-and-link a brand-new entity from a no-match query.
// The React surfaces (MentionPicker, EntityRefNode, the Lexical plugin) consume
// `resolveMentionAction`; `persistMention` then executes the decision against the
// runtime so the chip-insert path and the link-write path share ONE tested
// branch. Mirrors the drop-to-link split in ui/drop-link-toast.tsx (pure
// resolveKind in drag-payload.ts + impure createLinkWithToast).

import {
  DEFAULT_RELATION_KIND,
  type EntityLink,
  type EntityRef,
  type LinkOrigin,
  type RelationKind,
} from "../../lib/entity-links";
import type { ModuoRuntime } from "../../lib/runtime.types";

/**
 * Which gesture opened the picker. `@` mentions an entity/person (kind=mentions);
 * a `/`-ref (`/task` `/note` `/contact`) inserts a reference (kind=references).
 */
export type MentionTrigger = "mention" | "ref";

/**
 * The `/`-ref slash commands and the entity type each scopes the picker to.
 * Adding a command is a one-line change here (closed set at alpha, like the
 * relation kinds). `@` is not a slash command — it scopes to the whole registry.
 */
export const REF_COMMANDS: Record<string, string> = {
  task: "task",
  note: "note",
  contact: "contact",
};

/** The slash commands that open the ref picker, in menu order. */
export const REF_COMMAND_NAMES = Object.keys(REF_COMMANDS);

/** The entity type a `/`-command scopes to, or null if it isn't a ref command. */
export function refCommandType(command: string): string | null {
  return REF_COMMANDS[command.toLowerCase()] ?? null;
}

/** What the user picked in the {@link MentionPicker}. */
export type MentionPick =
  /** An existing registered entity (a task, contact, note…). */
  | { kind: "entity"; ref: EntityRef; label: string; icon?: string | null }
  /** A workspace member (a person) — produces a notification, not a link. */
  | { kind: "person"; userId: string; name: string }
  /** No match: create a new entity of `entityType` titled `label`, then link it. */
  | { kind: "create"; entityType: string; label: string };

/** The resolved decision — what {@link persistMention} should do. */
export type MentionAction =
  | {
      type: "link-entity";
      ref: EntityRef;
      label: string;
      icon: string | null;
      relationKind: RelationKind;
      origin: LinkOrigin;
    }
  | { type: "mention-person"; userId: string; name: string }
  | {
      type: "create-and-link";
      entityType: string;
      label: string;
      relationKind: RelationKind;
      origin: LinkOrigin;
    };

/**
 * The relation kind + origin implied by the trigger: `@` → `mentions`/`mention`,
 * `/ref` → `references` (the default kind)/`ref`. The single source of the
 * "kind=mentions for @, references for /ref" rule (AC8).
 */
export function triggerRelation(trigger: MentionTrigger): {
  relationKind: RelationKind;
  origin: LinkOrigin;
} {
  return trigger === "mention"
    ? { relationKind: "mentions", origin: "mention" }
    : { relationKind: DEFAULT_RELATION_KIND, origin: "ref" }; // references
}

/**
 * Decide the action for a pick under a trigger. Pure — no runtime, no editor.
 * A person is always a mention (you never `/ref` a person); an entity or a
 * no-match create both carry the trigger's relation kind + origin.
 */
export function resolveMentionAction(trigger: MentionTrigger, pick: MentionPick): MentionAction {
  if (pick.kind === "person") {
    return { type: "mention-person", userId: pick.userId, name: pick.name };
  }
  const { relationKind, origin } = triggerRelation(trigger);
  if (pick.kind === "create") {
    return {
      type: "create-and-link",
      entityType: pick.entityType,
      label: pick.label,
      relationKind,
      origin,
    };
  }
  return {
    type: "link-entity",
    ref: pick.ref,
    label: pick.label,
    icon: pick.icon ?? null,
    relationKind,
    origin,
  };
}

/** The outcome of {@link persistMention} — what the editor should insert. */
export type MentionResult =
  /** An entity ref chip; `link` is the written link (null only if person-routed). */
  | { kind: "entity"; ref: EntityRef; label: string; icon: string | null; link: EntityLink | null }
  /** A person mention; the notification is owned by CT-5, no chip-link is written. */
  | { kind: "person"; userId: string; name: string };

export type PersistMentionArgs = {
  runtime: ModuoRuntime;
  workspaceId: string;
  /** The entity being edited — the link source for every entity mention/ref. */
  focus: EntityRef;
  action: MentionAction;
  /**
   * Write the person-targeted activity row / notification. The spine surfaces
   * the branch at CT-4; CT-5 (comments + notification generalization) supplies
   * this handler. Until then a person mention inserts the chip but emits no row.
   */
  onMentionPerson?: (userId: string, name: string) => Promise<void> | void;
  /**
   * Create a new entity of the given type (no-match → create-and-link). The
   * owning module supplies its create op (e.g. Tasks → `tasks.createTask`); the
   * spine never reaches into a module's table. Required for the `create` pick.
   */
  createEntity?: (entityType: string, label: string) => Promise<EntityRef>;
};

/**
 * Execute a resolved {@link MentionAction} against the runtime. Entity mentions
 * and refs write one `entity_link` (focus → target) stamped with the trigger's
 * kind/origin, seeding the registry projection with the picked label/icon. A
 * no-match first creates the entity via the supplied `createEntity`, then links
 * it. A person mention routes to `onMentionPerson`. Returns what to render.
 */
export async function persistMention(args: PersistMentionArgs): Promise<MentionResult> {
  const { runtime, workspaceId, focus, action, onMentionPerson, createEntity } = args;

  if (action.type === "mention-person") {
    await onMentionPerson?.(action.userId, action.name);
    return { kind: "person", userId: action.userId, name: action.name };
  }

  if (action.type === "create-and-link") {
    if (!createEntity) {
      throw new Error(`Can’t create a ${action.entityType}: no creator was provided.`);
    }
    const ref = await createEntity(action.entityType, action.label);
    const link = await runtime.spine.createLink({
      workspaceId,
      source: focus,
      target: ref,
      relationKind: action.relationKind,
      origin: action.origin,
      targetLabel: action.label,
    });
    return { kind: "entity", ref, label: action.label, icon: null, link };
  }

  // link-entity
  const link = await runtime.spine.createLink({
    workspaceId,
    source: focus,
    target: action.ref,
    relationKind: action.relationKind,
    origin: action.origin,
    targetLabel: action.label,
    targetIcon: action.icon,
  });
  return { kind: "entity", ref: action.ref, label: action.label, icon: action.icon, link };
}
