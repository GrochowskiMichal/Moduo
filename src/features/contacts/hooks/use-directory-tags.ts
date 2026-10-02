// FX-3 — the directory's tag-filter data: all live workspace tags + every
// contact/company tag link, in one light read. Quiet on failure (the filter
// simply doesn't offer tags); reload() refreshes after tagging elsewhere.

import { useCallback, useEffect, useState } from "react";
import type { Truncation } from "../../../lib/paged-select";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Tag, TagLink } from "../../tasks/model";
import { CONTACT_TAGS_CHANGED_EVENT } from "../tags";

export function useDirectoryTags(runtime: ModuoRuntime | null, workspaceId: string | null) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [links, setLinks] = useState<TagLink[]>([]);
  /** SCALE-1: a workspace with more tag links than the cap — surfaced, never silent. */
  const [truncated, setTruncated] = useState<Truncation[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // A tag mutation on any card (hub tag row) refreshes the filter data, so an
  // ACTIVE tag filter reflects the change without reopening the menu.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener(CONTACT_TAGS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CONTACT_TAGS_CHANGED_EVENT, reload);
  }, [reload]);

  useEffect(() => {
    if (!runtime || !workspaceId) {
      setTags([]);
      setLinks([]);
      setTruncated([]);
      return;
    }
    let cancelled = false;
    runtime.tasks
      .listTagLinks({ workspaceId, entityTypes: ["contact", "company"] })
      .then((res) => {
        if (cancelled) return;
        setTags(res.tags);
        setLinks(res.links);
        setTruncated(res.truncated);
      })
      .catch(() => {
        /* quiet — the tag filter just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, tick]);

  return { tags, links, truncated, reload };
}
