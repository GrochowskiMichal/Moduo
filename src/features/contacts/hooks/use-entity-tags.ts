// FX-2 — tags on contacts & companies (AC3). One light read (workspace tags +
// this entity's links) plus optimistic toggle/create riding the generic tag
// ops — `tag_links.entity_type` is an open string, so 'contact'/'company'
// need no migration. Mirrors the Tasks flows (dedupe-by-name, pickTagColor,
// detach ≠ delete) without pulling the whole tasks bundle.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { pickTagColor, type LabelColor } from "../../../components/tag-colors";
import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Tag, TagLink } from "../../tasks/model";
import { attachedTags, findTagByName } from "../tags";

export function useEntityTags(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  focus: EntityRef | null,
) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [links, setLinks] = useState<TagLink[]>([]);
  const [tick, setTick] = useState(0);
  const busyRef = useRef(false);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!runtime || !workspaceId || !focus) {
      setTags([]);
      setLinks([]);
      return;
    }
    let cancelled = false;
    runtime.tasks
      .listEntityTags({ workspaceId, entityType: focus.type, entityId: focus.id })
      .then((res) => {
        if (cancelled) return;
        setTags(res.tags);
        setLinks(res.links);
      })
      .catch(() => {
        /* quiet — the tag row simply stays empty; retry rides the next reload */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, workspaceId, focus?.type, focus?.id, tick]);

  const attached = useMemo(() => attachedTags(tags, links), [tags, links]);

  /** Attach/detach one tag (optimistic; rollback + toast on failure). */
  const toggle = useCallback(
    (tagId: string) => {
      if (!runtime || !workspaceId || !focus) return;
      const existing = links.find((l) => l.tagId === tagId);
      const now = new Date().toISOString();
      if (existing) {
        setLinks((prev) => prev.filter((l) => l.tagId !== tagId));
        runtime.tasks
          .detachTag({ workspaceId, tagId, entityType: focus.type, entityId: focus.id })
          .catch((err) => {
            setLinks((prev) => [...prev, existing]);
            toast.error("Couldn’t remove the tag", { description: err instanceof Error ? err.message : undefined });
          });
      } else {
        const temp: TagLink = {
          id: `tmp-${crypto.randomUUID()}`,
          workspaceId,
          tagId,
          entityType: focus.type,
          entityId: focus.id,
          createdAt: now,
        };
        setLinks((prev) => [...prev, temp]);
        runtime.tasks
          .attachTag({ workspaceId, tagId, entityType: focus.type, entityId: focus.id })
          .then((saved) => setLinks((prev) => prev.map((l) => (l.id === temp.id ? saved : l))))
          .catch((err) => {
            setLinks((prev) => prev.filter((l) => l.id !== temp.id));
            toast.error("Couldn’t add the tag", { description: err instanceof Error ? err.message : undefined });
          });
      }
    },
    [runtime, workspaceId, focus?.type, focus?.id, links], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Create a workspace tag (auto-colored, dedupe-by-name) and attach it. */
  const create = useCallback(
    (name: string) => {
      if (!runtime || !workspaceId || !focus) return;
      const trimmed = name.trim();
      if (!trimmed || busyRef.current) return;
      const dupe = findTagByName(tags, trimmed);
      if (dupe) {
        if (!links.some((l) => l.tagId === dupe.id)) toggle(dupe.id);
        return;
      }
      busyRef.current = true;
      const now = new Date().toISOString();
      const draft: Tag = {
        id: "",
        workspaceId,
        ownerId: "",
        name: trimmed,
        color: pickTagColor(tags.filter((t) => !t.deletedAt)),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      void (async () => {
        // Track the saved tag so a failure at/after attach can clean up the
        // now-orphan workspace tag (mirrors Tasks' createTagForTask).
        let savedTagId: string | null = null;
        try {
          const saved = await runtime.tasks.upsertTag(draft);
          savedTagId = saved.id;
          setTags((prev) => [...prev, saved]);
          const link = await runtime.tasks.attachTag({
            workspaceId,
            tagId: saved.id,
            entityType: focus.type,
            entityId: focus.id,
          });
          setLinks((prev) => [...prev, link]);
        } catch (err) {
          toast.error("Couldn’t create the tag", { description: err instanceof Error ? err.message : undefined });
          if (savedTagId) {
            void runtime.tasks.deleteTag({ workspaceId, tagId: savedTagId }).catch(() => {});
          }
          reload();
        } finally {
          busyRef.current = false;
        }
      })();
    },
    [runtime, workspaceId, focus?.type, focus?.id, tags, links, toggle, reload], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Recolor a workspace tag (affects every surface that shows it). */
  const recolor = useCallback(
    (tagId: string, color: LabelColor) => {
      if (!runtime || !workspaceId) return;
      const tag = tags.find((t) => t.id === tagId);
      if (!tag) return;
      const prev = tag.color;
      setTags((p) => p.map((t) => (t.id === tagId ? { ...t, color } : t)));
      runtime.tasks
        .upsertTag({ ...tag, color })
        .then((saved) => setTags((p) => p.map((t) => (t.id === tagId ? saved : t))))
        .catch((err) => {
          setTags((p) => p.map((t) => (t.id === tagId ? { ...t, color: prev } : t)));
          toast.error("Couldn’t recolor the tag", { description: err instanceof Error ? err.message : undefined });
        });
    },
    [runtime, workspaceId, tags],
  );

  /** Delete a tag workspace-wide (the picker's destructive action, like Tasks). */
  const remove = useCallback(
    (tagId: string) => {
      if (!runtime || !workspaceId) return;
      const prevTags = tags;
      const prevLinks = links;
      setTags((p) => p.filter((t) => t.id !== tagId));
      setLinks((p) => p.filter((l) => l.tagId !== tagId));
      runtime.tasks.deleteTag({ workspaceId, tagId }).catch((err) => {
        setTags(prevTags);
        setLinks(prevLinks);
        toast.error("Couldn’t delete the tag", { description: err instanceof Error ? err.message : undefined });
      });
    },
    [runtime, workspaceId, tags, links],
  );

  return { tags, attached, toggle, create, recolor, remove, reload };
}
