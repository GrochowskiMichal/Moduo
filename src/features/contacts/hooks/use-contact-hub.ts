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
        const records = others.length ? await runtime.spine.getEntities({ workspaceId, refs: others }) : [];
        const byKey = new Map(records.map((r) => [entityRefKey({ type: r.type, id: r.id }), r]));

        // Open-items: resolve linked task statuses (lazily — only if any task links).
        let openTaskKeys = new Set<string>();
        if (others.some((o) => o.type === "task")) {
          const tasks = (await runtime.tasks.list(workspaceId)).tasks;
          openTaskKeys = new Set(
            tasks
              .filter((t) => t.status !== "done" && t.status !== "archived")
              .map((t) => entityRefKey({ type: "task", id: t.id })),
          );
        }
        if (!active) return;
        setActivity(activityRows);
        setRollup(buildContactRollup({ focus: focusRef, links, records: byKey, activity: activityRows, openTaskKeys }));
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
