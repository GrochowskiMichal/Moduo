/**
 * The header's agent-edit marker and its Undo (specs/notes-refresh.md NR-6,
 * AC11): "Research bot edited · 2 minutes ago · Undo".
 *
 * Who and when always come from the note's latest `notes.agent_edit`
 * activity row (server time, the key's real name). It is re-read whenever the
 * session's agent Undo gains a step, which is when an agent write lands.
 * Undo is offered only while that session holds the step (see
 * `sync/agent-origin.ts` for what it reverts and when it lapses).
 */

import { useCallback, useEffect, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { AgentEditMark } from "../note-meta";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";

const AGENT_EDIT_OP = "notes.agent_edit";

type ForNote<T> = { noteId: string; value: T };

export function useAgentEdit({
  runtime,
  engine,
  workspaceId,
  noteId,
}: {
  runtime: ModuoRuntime | null;
  engine: NotesSyncEngineV2 | null;
  workspaceId: string | null;
  /** The open (non-draft) note, or null. */
  noteId: string | null;
}): { agentEdit: AgentEditMark | null; canUndo: boolean; undo: () => void } {
  const [logged, setLogged] = useState<ForNote<AgentEditMark | null> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  // Bumped when an agent write lands, to re-read the activity row.
  const [arrivals, setArrivals] = useState(0);
  // The server time of the mark that was undone: it (and anything older)
  // stops showing, so the line goes back to the person's own edit.
  const [undone, setUndone] = useState<ForNote<string> | null>(null);

  useEffect(() => {
    setCanUndo(false);
    if (!engine || !noteId) return;
    // The shell and the editor create the session while rendering, so it
    // exists by the time this effect runs.
    const agentUndo = engine.agentUndo(noteId);
    if (!agentUndo) return;
    let had = agentUndo.canUndo();
    setCanUndo(had);
    return agentUndo.subscribe(() => {
      const can = agentUndo.canUndo();
      if (can && !had) setArrivals((n) => n + 1);
      had = can;
      setCanUndo(can);
    });
  }, [engine, noteId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `arrivals` re-reads after an agent write lands
  useEffect(() => {
    const tasks = runtime?.tasks;
    if (typeof tasks?.listActivity !== "function" || !workspaceId || !noteId) return;
    let cancelled = false;
    Promise.resolve()
      .then(() =>
        tasks.listActivity({
          workspaceId,
          entityType: "note",
          entityId: noteId,
          module: "notes",
          limit: 20,
        }),
      )
      .then((entries) => {
        if (cancelled) return;
        const row = entries.find((e) => e.op === AGENT_EDIT_OP);
        setLogged({ noteId, value: row ? { label: row.actorLabel, at: row.createdAt } : null });
      })
      .catch(() => {
        // The marker is a nicety; a failed read leaves the plain "Edited …".
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, noteId, arrivals]);

  let agentEdit = logged && logged.noteId === noteId ? logged.value : null;
  const undoneAt = undone && undone.noteId === noteId ? undone.value : null;
  if (agentEdit && undoneAt && Date.parse(agentEdit.at) <= Date.parse(undoneAt)) agentEdit = null;

  const undo = useCallback(() => {
    if (!engine || !noteId) return;
    engine.agentUndo(noteId)?.undo();
    if (agentEdit) setUndone({ noteId, value: agentEdit.at });
  }, [engine, noteId, agentEdit]);

  return { agentEdit, canUndo, undo };
}
