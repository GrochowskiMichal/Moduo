// What each meeting in Day view links to (CALR-12, AC13): one `entity_links`
// read per meeting (the spine has no multi-entity read) and ONE batched
// registry read for every note and task they point at. Only Day view asks, so
// it is one day's meetings at most (capped); a stale reply never paints.

import { useEffect, useState } from "react";

import type { EntityRef } from "../../../lib/entity-links";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { entityRefKey, otherEndpoint } from "../../spine/rollup";
import type { PrepLinks } from "../day-prep";

/** Each meeting's linked notes and tasks: one links read per meeting, one registry batch. */
export async function readPrepLinks(
  runtime: ModuoRuntime,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, PrepLinks>> {
  const perEvent = await Promise.all(
    ids.map(async (id) => {
      const focus: EntityRef = { type: "event", id };
      const links = await runtime.spine.listLinks({
        workspaceId,
        entityType: "event",
        entityId: id,
      });
      const others = links
        .map((l) => otherEndpoint(focus, l))
        .filter((r): r is EntityRef => r !== null && (r.type === "note" || r.type === "task"));
      return { id, others };
    }),
  );
  const refs = new Map<string, EntityRef>();
  for (const { others } of perEvent) for (const r of others) refs.set(entityRefKey(r), r);
  const records = refs.size
    ? await runtime.spine.getEntities({ workspaceId, refs: [...refs.values()] })
    : [];
  const byKey = new Map(records.filter((r) => !r.deletedAt).map((r) => [entityRefKey(r), r]));
  const out = new Map<string, PrepLinks>();
  for (const { id, others } of perEvent) {
    const prep: PrepLinks = { notes: [], tasks: [] };
    for (const ref of others) {
      const rec = byKey.get(entityRefKey(ref));
      if (!rec) continue;
      if (ref.type === "note") prep.notes.push({ id: ref.id, title: rec.label });
      else prep.tasks.push({ id: ref.id, title: rec.label, done: false });
    }
    out.set(id, prep);
  }
  return out;
}

/** Meetings a day reads links for; a busier day shows prep on the first ones. */
export const PREP_MAX_EVENTS = 24;

const NONE: ReadonlyMap<string, PrepLinks> = new Map();

export function useDayPrepLinks(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  eventIds: readonly string[],
  /** Done in your task list (the registry knows titles, not status). */
  isTaskDone: (taskId: string) => boolean,
): ReadonlyMap<string, PrepLinks> {
  const [state, setState] = useState<{ key: string; links: ReadonlyMap<string, PrepLinks> }>({
    key: "",
    links: NONE,
  });
  const ids = [...new Set(eventIds)].slice(0, PREP_MAX_EVENTS);
  const key = `${workspaceId ?? ""}|${ids.join(",")}`;

  useEffect(() => {
    if (!runtime || !workspaceId || ids.length === 0) return;
    let active = true;
    readPrepLinks(runtime, workspaceId, ids).then(
      (links) => {
        if (active) setState({ key, links });
      },
      () => {
        // Prep is a nicety: a failed read leaves the meetings as they are.
      },
    );
    return () => {
      active = false;
    };
    // `ids` is captured by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, workspaceId, key]);

  if (state.key !== key) return NONE;
  // Done-ness is read now, so ticking a follow-up off moves the prep to the next one.
  const out = new Map<string, PrepLinks>();
  for (const [id, prep] of state.links) {
    out.set(id, { ...prep, tasks: prep.tasks.map((t) => ({ ...t, done: isTaskDone(t.id) })) });
  }
  return out;
}
