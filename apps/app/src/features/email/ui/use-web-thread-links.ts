// What each linked email on the web is linked to (specs/mail-v3.md §13): the
// tasks, notes and events at the other end of its `email_thread` links, named
// from the registry in one batched read. Best-effort: on a failure the links
// stay unknown and the page shows every tissue thread without chips.

import { useEffect, useState } from "react";

import type { EntityRef } from "@/lib/entity-links";
import type { EmailThreadRef, ModuoRuntime } from "@/lib/runtime.types";

export type WebLinkedEntity = {
  kind: "task" | "note" | "calendar_event";
  id: string;
  title: string;
};

const KINDS = new Set<string>(["task", "note", "calendar_event"]);
/** The newest threads whose links are read (the page lists the linked ones). */
const MAX_REFS = 50;

type Spine = Pick<ModuoRuntime["spine"], "listLinks" | "getEntities">;

/** Each ref's linked tasks, notes and events, named. */
export async function readThreadLinks(
  spine: Spine,
  workspaceId: string,
  refs: readonly EmailThreadRef[],
): Promise<Record<string, WebLinkedEntity[]>> {
  const newest = [...refs]
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
    .slice(0, MAX_REFS);
  const ends = await Promise.all(
    newest.map(async (ref) => {
      const links = await spine.listLinks({
        workspaceId,
        entityType: "email_thread",
        entityId: ref.id,
      });
      const others = links
        .filter((l) => !l.deletedAt)
        .map((l) =>
          l.sourceType === "email_thread" && l.sourceId === ref.id
            ? { type: l.targetType, id: l.targetId }
            : { type: l.sourceType, id: l.sourceId },
        )
        .filter((e) => KINDS.has(e.type));
      return [ref.id, others] as const;
    }),
  );
  const wanted = new Map<string, EntityRef>();
  for (const [, others] of ends)
    for (const e of others) wanted.set(`${e.type}:${e.id}`, e as EntityRef);
  const records =
    wanted.size > 0 ? await spine.getEntities({ workspaceId, refs: [...wanted.values()] }) : [];
  const label = new Map(
    records.filter((r) => !r.deletedAt).map((r) => [`${r.type}:${r.id}`, r.label] as const),
  );
  const out: Record<string, WebLinkedEntity[]> = {};
  for (const [refId, others] of ends) {
    out[refId] = others
      .filter((e) => label.has(`${e.type}:${e.id}`))
      .map((e) => ({
        kind: e.type as WebLinkedEntity["kind"],
        id: e.id,
        title: label.get(`${e.type}:${e.id}`) || "Untitled",
      }));
  }
  return out;
}

export function useWebThreadLinks(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  refs: readonly EmailThreadRef[],
): { links: Record<string, WebLinkedEntity[]> | undefined; loading: boolean } {
  const [state, setState] = useState<{
    key: string;
    links: Record<string, WebLinkedEntity[]> | undefined;
  } | null>(null);
  const key = `${workspaceId}:${refs.map((r) => `${r.id}@${r.updatedAt}`).join(",")}`;
  useEffect(() => {
    if (!runtime || !workspaceId || refs.length === 0) return;
    let gone = false;
    void readThreadLinks(runtime.spine, workspaceId, refs).then(
      (links) => !gone && setState({ key, links }),
      () => !gone && setState({ key, links: undefined }),
    );
    return () => {
      gone = true;
    };
    // `key` covers the refs that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, key]);
  if (!runtime || !workspaceId || refs.length === 0) return { links: undefined, loading: false };
  return state?.key === key
    ? { links: state.links, loading: false }
    : { links: undefined, loading: true };
}
