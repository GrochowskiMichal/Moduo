// One item's tag row (contact, company, note, email thread): reads the item's
// tags and seeds the shared workspace tag store with them (TV-T1), then reads
// and writes through the store, so a tag added here shows in Tasks' picker and
// every other surface at once, and the other way round.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import {
  createOrAttachByName,
  deleteTag,
  recolorTag,
  seedTags,
  type TagContext,
  tagsOf,
  toggleTag,
  useTagView,
} from "../store";

export function useEntityTags(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  focus: EntityRef | null,
) {
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const view = useTagView(workspaceId);
  const entityType = focus?.type ?? null;
  const entityId = focus?.id ?? null;
  const entity = useMemo(
    () => (entityType && entityId ? { entityType, entityId } : null),
    [entityType, entityId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the reload cue.
  useEffect(() => {
    if (!runtime || !workspaceId || !entity) return;
    let cancelled = false;
    const at = Date.now();
    runtime.tasks
      .listEntityTags({ workspaceId, ...entity })
      .then((res) => {
        if (cancelled) return;
        seedTags(workspaceId, {
          tags: res.tags,
          links: res.links,
          scope: { kind: "entity", ...entity },
          at,
        });
      })
      .catch(() => {
        /* quiet — the row shows what the store already has; retry rides the next reload */
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, entity, tick]);

  const ctx = useMemo<TagContext | null>(
    () => (runtime && workspaceId ? { runtime, workspaceId } : null),
    [runtime, workspaceId],
  );
  const attached = useMemo(() => (entity ? tagsOf(view, entity) : []), [view, entity]);

  /** Attach/detach one tag (shown at once; undone with a toast on failure). */
  const toggle = useCallback(
    (tagId: string) => {
      if (ctx && entity) toggleTag(ctx, entity, tagId);
    },
    [ctx, entity],
  );

  /** Attach the tag with this name, or create it (auto-coloured) and attach it. */
  const create = useCallback(
    (name: string) => {
      if (ctx && entity) createOrAttachByName(ctx, name, entity);
    },
    [ctx, entity],
  );

  /** Recolor a workspace tag (affects every surface that shows it). */
  const recolor = useCallback(
    (tagId: string, color: string) => {
      if (ctx) recolorTag(ctx, tagId, color);
    },
    [ctx],
  );

  /** Delete a tag workspace-wide (the picker's destructive action), with Undo. */
  const remove = useCallback(
    (tagId: string) => {
      if (ctx) deleteTag(ctx, tagId);
    },
    [ctx],
  );

  return { tags: view.tags, attached, toggle, create, recolor, remove, reload };
}
