// The Inbox's agent chip (TV-U13b; TV-U15 and TV-D16 left it): which Inbox
// tasks an agent made through an API key, and that key's name ("via Claude
// Desktop"). Read from the tasks' own `tasks.create` trail rows (decision
// U13b-3: no new column), batched, once per task: the trail's read policy
// answers only tasks the reader can see, so a key's name never reaches anyone
// else. Kept in memory only (never in the device copy); a new capture brings
// one small read for its own id.

import { useEffect, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { agentViaOf } from "../inbox-triage";

const NONE: ReadonlyMap<string, string> = new Map();

export function useAgentCaptures(
  runtime: ModuoRuntime | null,
  workspaceId: string,
  taskIds: readonly string[],
  enabled: boolean,
): ReadonlyMap<string, string> {
  const [via, setVia] = useState<{ ws: string; map: ReadonlyMap<string, string> }>({
    ws: workspaceId,
    map: NONE,
  });
  // The ids asked about in this workspace (answered or on their way).
  const asked = useRef<{ ws: string; ids: Set<string> }>({ ws: workspaceId, ids: new Set() });
  const key = taskIds.join(",");

  useEffect(() => {
    if (!enabled || !runtime || !workspaceId) return;
    if (asked.current.ws !== workspaceId) asked.current = { ws: workspaceId, ids: new Set() };
    const seen = asked.current.ids;
    const fresh = taskIds.filter((id) => !seen.has(id) && !id.startsWith("tmp-"));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.add(id);
    const ws = workspaceId;
    runtime.tasks
      .listAgentCaptures({ workspaceId: ws, taskIds: fresh })
      .then((rows) => {
        if (asked.current.ws !== ws || rows.length === 0) return;
        setVia((prev) => {
          const map = new Map(prev.ws === ws ? prev.map : NONE);
          for (const row of rows) {
            const name = agentViaOf(row.label);
            if (name) map.set(row.taskId, name);
          }
          return { ws, map };
        });
      })
      .catch(() => {
        // Offline or refused: ask again the next time the Inbox changes.
        if (asked.current.ws === ws) for (const id of fresh) seen.delete(id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the ids.
  }, [enabled, runtime, workspaceId, key]);

  return via.ws === workspaceId ? via.map : NONE;
}
