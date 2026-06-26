// Connective-tissue spine — the EntityHub data hook (block CT-2).
//
// Composes the one-query roll-up read: one indexed `entity_links` read for the
// focus entity + one batched registry read for the other endpoints, fed through
// the pure `rollupSections` reducer. Never N per-module fan-outs (AC6).

import { useCallback, useEffect, useState } from "react";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { entityRefKey, otherEndpoint, rollupSections, type HubSection } from "../rollup";

export type HubStatus = "loading" | "error" | "ready";

export type UseEntityHubResult = {
  status: HubStatus;
  sections: HubSection[];
  /** Re-run the read (e.g. after a link mutation). Stale results are discarded. */
  reload: () => void;
};

export function useEntityHub(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  focus: EntityRef | null,
): UseEntityHubResult {
  const [status, setStatus] = useState<HubStatus>("loading");
  const [sections, setSections] = useState<HubSection[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const focusType = focus?.type ?? null;
  const focusId = focus?.id ?? null;

  const reload = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!runtime || !workspaceId || !focusType || !focusId) return;
    const focusRef: EntityRef = { type: focusType, id: focusId };
    // Cancellation guard: if focus changes (or we refresh) while a read is in
    // flight, the stale response must not paint into the new entity's hub.
    let active = true;
    setStatus("loading");
    void (async () => {
      try {
        const links = await runtime.spine.listLinks({
          workspaceId,
          entityType: focusType,
          entityId: focusId,
        });
        const others = links
          .map((l) => otherEndpoint(focusRef, l))
          .filter((r): r is EntityRef => r !== null);
        const records = others.length
          ? await runtime.spine.getEntities({ workspaceId, refs: others })
          : [];
        if (!active) return;
        const byKey = new Map(records.map((r) => [entityRefKey({ type: r.type, id: r.id }), r]));
        setSections(rollupSections(focusRef, links, byKey));
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, focusType, focusId, refreshTick]);

  return { status, sections, reload };
}
