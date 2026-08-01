// CompanyHub data hook (block CO-4, AC8): the company → people union read. One
// indexed read for the company's links + its activity, then one indexed read per
// person (denormalized members ∪ works-at-linked people), then one batched
// registry lookup for every union endpoint — folded by buildCompanyRollup. The
// per-member fan-out is on-the-fly (decision 4: don't pre-materialize; promote to
// a view only if profiling misses the bar at large N).

import { useCallback, useEffect, useRef, useState } from "react";

import type { EntityLink, EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { entityRefKey, otherEndpoint } from "../../spine/rollup";
import type { ActivityEntry } from "../../tasks/model";
import { buildCompanyRollup, type CompanyRollup } from "../company";
import type { Contact } from "../model";
import { enrichHubRows } from "./enrich-hub-rows";
import "../../spine/snippet-projectors.builtin";

const EMPTY: CompanyRollup = {
  people: [],
  unionSections: [],
  lastTouchAt: null,
  lastTouchActivity: null,
};

export type UseCompanyHubResult = {
  rollup: CompanyRollup;
  activity: ActivityEntry[];
  status: HubStatus;
  /** `entityRefKey`s of the company's OWN direct links — the drag duplicate guard (FX-9). */
  directLinkKeys: Set<string>;
  reload: () => void;
};

export function useCompanyHub(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  company: EntityRef | null,
  members: Contact[],
): UseCompanyHubResult {
  const [rollup, setRollup] = useState<CompanyRollup>(EMPTY);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [status, setStatus] = useState<HubStatus>("loading");
  const [directLinkKeys, setDirectLinkKeys] = useState<Set<string>>(() => new Set());
  const [tick, setTick] = useState(0);

  // Read members through a ref so the effect re-runs on the member *set* (the
  // stable key below), not on every parent re-render that re-derives the array.
  const membersRef = useRef(members);
  membersRef.current = members;
  const memberKey = members.map((m) => m.id).join(",");

  const companyId = company?.id ?? null;
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!runtime || !workspaceId || !companyId) return;
    const companyRef: EntityRef = { type: "company", id: companyId };
    const denormalized = membersRef.current;
    let active = true;
    setStatus("loading");
    void (async () => {
      try {
        const [companyLinks, activityRows] = await Promise.all([
          runtime.spine.listLinks({ workspaceId, entityType: "company", entityId: companyId }),
          runtime.tasks.listActivity({
            workspaceId,
            entityType: "company",
            entityId: companyId,
            limit: 30,
          }),
        ]);

        // Every person: denormalized members ∪ works-at-linked contacts.
        const worksAt = companyLinks
          .filter((l) => l.relationKind === "works-at")
          .map((l) => otherEndpoint(companyRef, l))
          .filter((r): r is EntityRef => r !== null && r.type === "contact");
        const personIds = Array.from(
          new Set([...denormalized.map((m) => m.id), ...worksAt.map((p) => p.id)]),
        );

        const lists = await Promise.all(
          personIds.map((id) =>
            runtime.spine.listLinks({ workspaceId, entityType: "contact", entityId: id }),
          ),
        );
        const memberLinks: Record<string, EntityLink[]> = {};
        personIds.forEach((id, i) => {
          memberLinks[id] = lists[i];
        });

        // Batched registry lookup for every endpoint we'll project.
        const refs: EntityRef[] = [];
        companyLinks.forEach((l) => {
          const o = otherEndpoint(companyRef, l);
          if (o) refs.push(o);
        });
        personIds.forEach((id) => {
          const focus: EntityRef = { type: "contact", id };
          (memberLinks[id] ?? []).forEach((l) => {
            const o = otherEndpoint(focus, l);
            if (o) refs.push(o);
          });
        });
        const uniqueRefs = Array.from(new Map(refs.map((r) => [entityRefKey(r), r])).values());
        const [records, enrichment] = await Promise.all([
          uniqueRefs.length
            ? runtime.spine.getEntities({ workspaceId, refs: uniqueRefs })
            : Promise.resolve([]),
          uniqueRefs.length
            ? enrichHubRows(runtime, workspaceId, uniqueRefs)
            : Promise.resolve(null),
        ]);
        const byKey = new Map(records.map((r) => [entityRefKey({ type: r.type, id: r.id }), r]));

        if (!active) return;
        setActivity(activityRows);
        setDirectLinkKeys(
          new Set(
            companyLinks
              .map((l) => otherEndpoint(companyRef, l))
              .filter((r): r is EntityRef => r !== null)
              .map((r) => entityRefKey(r)),
          ),
        );
        setRollup(
          buildCompanyRollup({
            company: companyRef,
            companyLinks,
            members: denormalized,
            memberLinks,
            records: byKey,
            activity: activityRows,
            snippetMeta: enrichment?.snippetMeta,
            now: new Date(),
          }),
        );
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, companyId, memberKey, tick]);

  return { rollup, activity, status, directLinkKeys, reload };
}
