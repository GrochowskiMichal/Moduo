// Connective-tissue spine — the registry-backed mention search hook (block CT-4).
//
// Feeds the MentionPicker / caret menu: debounced `entities.search` over the
// registry, plus (for the `@` trigger only) the workspace member list, merged
// into the ordered candidate list by the pure `buildMentionCandidates`. Stale
// responses are dropped (last-write-wins via a request counter). Decoupled from
// any surface — callers pass the runtime + workspace + trigger.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  buildMentionCandidates,
  type MentionCandidate,
  type MentionTrigger,
  type SearchedEntity,
  type SearchedPerson,
} from "../mention";

type Options = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  trigger: MentionTrigger;
  /** Restrict entity search to these types (e.g. `["task"]` for `/task`). */
  types?: string[];
  /** The entity type a `/ref` create-and-link makes; null = no create offered. */
  createType?: string | null;
  /** Whether a creator is wired for `createType` (gates the "Create…" item). */
  canCreate?: boolean;
  /** The current user's id — excluded from the people list. */
  currentUserId?: string | null;
  /**
   * Offer workspace members as `@`-mention candidates. Default true; a surface
   * with no way to notify a person (the activity op lands with CT-5) should pass
   * false so `@person` is never shown as a silently-failing option.
   */
  includePeople?: boolean;
  /**
   * Offer entities as candidates. Default true; the Notes `@` surface passes
   * false — its ratified grammar is `@` = people ONLY, entities ride the `/`
   * nouns (Wave-3 NO-4, AC5).
   */
  includeEntities?: boolean;
  /** When false, the search is idle (no queries fired). Defaults to true. */
  enabled?: boolean;
  debounceMs?: number;
};

export type UseMentionSearchResult = {
  query: string;
  setQuery: (value: string) => void;
  candidates: MentionCandidate[];
  loading: boolean;
};

function memberToPerson(member: unknown, query: string): SearchedPerson | null {
  const row = member as { user_id?: unknown; profiles?: Record<string, unknown> } | null;
  const id = row?.user_id;
  if (typeof id !== "string") return null;
  const profile = row?.profiles ?? {};
  const label = String(profile.display_name || profile.email || "Member");
  const q = query.trim().toLowerCase();
  if (q && !label.toLowerCase().includes(q)) return null;
  return { memberId: id, label, icon: null };
}

export function useMentionSearch({
  runtime,
  workspaceId,
  trigger,
  types,
  createType,
  canCreate,
  currentUserId,
  includePeople = true,
  includeEntities = true,
  enabled = true,
  debounceMs = 150,
}: Options): UseMentionSearchResult {
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<SearchedEntity[]>([]);
  const [people, setPeople] = useState<SearchedPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);
  const typesKey = (types ?? []).join(",");

  useEffect(() => {
    if (!enabled || !runtime || !workspaceId) {
      setEntities([]);
      setPeople([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let ents: SearchedEntity[] = [];
          if (includeEntities) {
            const records = await runtime.spine.searchEntities({
              workspaceId,
              query,
              types: typesKey ? typesKey.split(",") : undefined,
              limit: 8,
            });
            ents = records.map((r) => ({
              type: r.type,
              id: r.id,
              label: r.label,
              icon: r.icon,
            }));
          }
          let ppl: SearchedPerson[] = [];
          if (trigger === "mention" && includePeople) {
            const members = await runtime.workspace.listMembers(workspaceId);
            ppl = members
              .map((m) => memberToPerson(m, query))
              .filter((p): p is SearchedPerson => p !== null && p.memberId !== currentUserId)
              .slice(0, 6);
          }
          if (reqId === reqRef.current) {
            setEntities(ents);
            setPeople(ppl);
          }
        } catch {
          if (reqId === reqRef.current) {
            setEntities([]);
            setPeople([]);
          }
        } finally {
          if (reqId === reqRef.current) setLoading(false);
        }
      })();
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    runtime,
    workspaceId,
    trigger,
    query,
    typesKey,
    currentUserId,
    includePeople,
    includeEntities,
    debounceMs,
  ]);

  const candidates = useMemo(
    () => buildMentionCandidates({ trigger, query, entities, people, createType, canCreate }),
    [trigger, query, entities, people, createType, canCreate],
  );

  return { query, setQuery, candidates, loading };
}
