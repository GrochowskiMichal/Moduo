// FX-3 — the directory's tag-filter data: all live workspace tags + every
// contact/company tag link, in one light read that seeds the shared tag store
// (TV-T1). Reads come back out of the store, so tagging a card (or anything
// else) updates an active tag filter at once. Quiet on failure (the filter
// simply doesn't offer tags); reload() re-reads the server.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Truncation } from "../../../lib/paged-select";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { seedTags, useTagView } from "../../tags/store";

const DIRECTORY_TYPES = ["contact", "company"] as const;

export function useDirectoryTags(runtime: ModuoRuntime | null, workspaceId: string | null) {
  /** SCALE-1: a workspace with more tag links than the cap — surfaced, never silent. */
  const [truncated, setTruncated] = useState<Truncation[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const view = useTagView(workspaceId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the reload cue.
  useEffect(() => {
    if (!runtime || !workspaceId) {
      setTruncated([]);
      return;
    }
    let cancelled = false;
    const at = Date.now();
    runtime.tasks
      .listTagLinks({ workspaceId, entityTypes: [...DIRECTORY_TYPES] })
      .then((res) => {
        if (cancelled) return;
        seedTags(workspaceId, {
          tags: res.tags,
          links: res.links,
          scope: { kind: "types", entityTypes: DIRECTORY_TYPES },
          at,
          // A capped read only adds what it saw (SCALE-1).
          complete: res.truncated.length === 0,
        });
        setTruncated(res.truncated);
      })
      .catch(() => {
        /* quiet — the tag filter just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, tick]);

  const links = useMemo(
    () => view.links.filter((l) => (DIRECTORY_TYPES as readonly string[]).includes(l.entityType)),
    [view.links],
  );

  return { tags: view.tags, links, truncated, reload };
}
