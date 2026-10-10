// Connective-tissue spine — the mention executor (block CT-4).
//
// The runtime half of the `@` / `/ref` gesture: given a plan produced by the
// pure `resolveMention`, perform the writes and return the entity to render as
// an inline chip (or null for a person mention, which inserts no chip). All
// branch logic lives in `resolveMention`; this only calls the runtime + the
// host-provided seams. Two seams stay host-owned so the spine doesn't reach into
// sibling modules: `onCreateEntity` (e.g. Tasks' create op for `/task Foo`) and
// `onMentionPerson` (the person-targeted activity row — its op lands with CT-5).

import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { MentionResolution } from "./mention";

/** The entity to insert as an inline `EntityRefChip` after a successful write. */
export type MentionInsert = { ref: EntityRef; label: string; icon: string | null };

export type MentionContext = {
  workspaceId: string;
  /** The text surface's own entity (e.g. the note) — the link's source end. */
  source: EntityRef;
  /** Registry label/icon for the source (seeds the registry on link). */
  sourceLabel?: string;
  sourceIcon?: string | null;
  /**
   * Create the entity for a `/ref Foo` no-match, returning its ref + label/icon
   * (or null to abort). Host-owned so Tasks/Contacts create ops stay out of the
   * spine. Absent → create-and-link is a no-op (and the picker hides "Create…").
   */
  onCreateEntity?: (entityType: string, label: string) => Promise<MentionInsert | null>;
  /**
   * Write the person-mention activity row targeting a member. The concrete op
   * lands with CT-5 (notification/activity generalization); until then the host
   * may leave this unset (the mention text is still inserted).
   */
  onMentionPerson?: (memberId: string, label: string) => Promise<void> | void;
};

/**
 * Execute a resolved mention against the runtime. Returns the entity to render
 * inline (a `link` / `create-and-link`), or null (a `notify-person`).
 */
export async function executeMention(
  runtime: ModuoRuntime,
  ctx: MentionContext,
  resolution: MentionResolution,
): Promise<MentionInsert | null> {
  switch (resolution.action) {
    case "link": {
      await runtime.spine.createLink({
        workspaceId: ctx.workspaceId,
        source: ctx.source,
        target: resolution.target,
        relationKind: resolution.relationKind,
        origin: resolution.origin,
        sourceLabel: ctx.sourceLabel,
        sourceIcon: ctx.sourceIcon ?? null,
        targetLabel: resolution.label,
        targetIcon: resolution.icon,
      });
      return { ref: resolution.target, label: resolution.label, icon: resolution.icon };
    }
    case "create-and-link": {
      if (!ctx.onCreateEntity) return null;
      const created = await ctx.onCreateEntity(resolution.entityType, resolution.label);
      if (!created) return null;
      await runtime.spine.createLink({
        workspaceId: ctx.workspaceId,
        source: ctx.source,
        target: created.ref,
        relationKind: resolution.relationKind,
        origin: resolution.origin,
        sourceLabel: ctx.sourceLabel,
        sourceIcon: ctx.sourceIcon ?? null,
        targetLabel: created.label,
        targetIcon: created.icon,
      });
      return created;
    }
    case "notify-person": {
      await ctx.onMentionPerson?.(resolution.memberId, resolution.label);
      return null;
    }
    // A date chip and a `#tag` link are text: nothing to write.
    case "insert-date":
    case "insert-tag":
      return null;
  }
}
