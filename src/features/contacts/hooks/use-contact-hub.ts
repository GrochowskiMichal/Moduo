// ContactHub data hook (block CO-2, AC2): the on-the-fly roll-up read. One
// indexed `entity_links` read + one batched registry lookup + the entity's
// activity trail, folded by buildContactRollup. Open-items needs linked task
// statuses, so it lazily loads the tasks bundle ONLY when the contact has linked
// tasks (decision 4: on-the-fly, no premature materialization). A stale read is
// discarded if the selection changes mid-flight.

import { useCallback, useEffect, useState } from "react";

import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { ActivityEntry } from "../../tasks/model";
import { entityRefKey, otherEndpoint } from "../../spine/rollup";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { buildContactRollup, type ContactRollup } from "../rollup";
import { enrichHubRows } from "./enrich-hub-rows";
import "../../spine/snippet-projectors.builtin";

const EMPTY_ROLLUP: ContactRollup = {
  sections: [],
  lastTouchAt: null,
  lastTouchActivity: null,
  openTaskCount: 0,
  unpaidPaymentCount: 0,
};

export type UseContactHubResult = {
  hubStatus: HubStatus;
  rollup: ContactRollup;
  activity: ActivityEntry[];
  reload: () => void;
};

export function useContactHub(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  focus: EntityRef | null,
): UseContactHubResult {
  const [rollup, setRollup] = useState<ContactRollup>(EMPTY_ROLLUP);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [hubStatus, setHubStatus] = useState<HubStatus>("loading");
  const [tick, setTick] = useState(0);

  const focusType = focus?.type ?? null;
  const focusId = focus?.id ?? null;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!runtime || !workspaceId || !focusType || !focusId) return;
    const focusRef: EntityRef = { type: focusType, id: focusId };
    let active = true;
    setHubStatus("loading");
    void (async () => {
      try {
        const [links, activityRows] = await Promise.all([
          runtime.spine.listLinks({ workspaceId, entityType: focusType, entityId: focusId }),
          runtime.tasks.listActivity({ workspaceId, entityType: focusType, entityId: focusId, limit: 30 }),
        ]);
        const others = links
          .map((l) => otherEndpoint(focusRef, l))
          .filter((r): r is EntityRef => r !== null);
        // The registry projection + the live enrichment both depend only on
        // `others` — fetch them in parallel (one round-trip, not two). Enrichment:
        // linked task statuses (open-items) + row snippets (task due, note
        // touched-at, event when); one batched read per linked module, degrading
        // per-module (AC6, DF-7).
        const [records, enrichment] = others.length
          ? await Promise.all([
              runtime.spine.getEntities({ workspaceId, refs: others }),
              enrichHubRows(runtime, workspaceId, others),
            ])
          : [[], null];
        const byKey = new Map(records.map((r) => [entityRefKey({ type: r.type, id: r.id }), r]));
        const snippetMeta = enrichment?.snippetMeta;
        const openTaskKeys = enrichment?.openTaskKeys ?? new Set<string>();
        if (!active) return;
        setActivity(activityRows);
        setRollup(
          buildContactRollup({
            focus: focusRef,
            links,
            records: byKey,
            activity: activityRows,
            openTaskKeys,
            snippetMeta,
            now: new Date(),
          }),
        );
        setHubStatus("ready");
      } catch {
        if (active) setHubStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, focusType, focusId, tick]);

  return { hubStatus, rollup, activity, reload };
}
