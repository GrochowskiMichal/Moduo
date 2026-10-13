/**
 * The header's agent-edit marker and its Undo (specs/notes-refresh.md NR-6,
 * AC11): "Research bot edited · 2 minutes ago · Undo".
 *
 * Two sources, newest wins:
 * - the note's latest `notes.agent_edit` activity row (who and when, also for
 *   an agent write that landed while the note was closed);
 * - the session's agent Undo, which hears a live write the moment it lands.
 *
 * Undo is offered only while the session holds an undo step: it reverts the
 * agent's change and keeps every human edit made since (see
 * `sync/agent-origin.ts`).
 */

import { useCallback, useEffect, useState } from "react";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { AgentEditMark } from "../note-meta";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";

const AGENT_EDIT_OP = "notes.agent_edit";

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
  const [logged, setLogged] = useState<{ noteId: string; mark: AgentEditMark } | null>(null);
  const [live, setLive] = useState<{ noteId: string; mark: AgentEditMark } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  // Bumped whenever an agent write lands live, to re-read the activity row
  // (it carries the key's name when the broadcast didn't).
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setCanUndo(false);
    setLive(null);
    if (!engine || !noteId) return;
    // The session exists once the editor mounted; it may not yet on the
    // first render, so look again shortly.
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attach = () => {
      const undo = engine.agentUndo(noteId);
      if (!undo) {
        timer = setTimeout(attach, 250);
        return;
      }
      const sync = () => {
        setCanUndo(undo.canUndo());
        const last = undo.last();
        if (last) {
          setLive({ noteId, mark: { label: last.label, at: new Date(last.at).toISOString() } });
        }
        setTick((t) => t + 1);
      };
      setCanUndo(undo.canUndo());
      unsubscribe = undo.subscribe(sync);
    };
    attach();
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [engine, noteId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-reads after a live agent write
  useEffect(() => {
    if (!runtime || !workspaceId || !noteId) return;
    let cancelled = false;
    runtime.tasks
      .listActivity({
        workspaceId,
        entityType: "note",
        entityId: noteId,
        module: "notes",
        limit: 20,
      })
      .then((entries) => {
        if (cancelled) return;
        const row = entries.find((e) => e.op === AGENT_EDIT_OP);
        setLogged(row ? { noteId, mark: { label: row.actorLabel, at: row.createdAt } } : null);
      })
      .catch(() => {
        // The marker is a nicety; a failed read leaves the plain "Edited …".
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, noteId, tick]);

  const fromLog = logged && logged.noteId === noteId ? logged.mark : null;
  const fromLive = live && live.noteId === noteId ? live.mark : null;
  let agentEdit: AgentEditMark | null = fromLog;
  if (fromLive && (!fromLog || Date.parse(fromLive.at) > Date.parse(fromLog.at))) {
    // The broadcast may not carry a name; keep the logged one for the key.
    agentEdit = { label: fromLive.label ?? fromLog?.label ?? null, at: fromLive.at };
  }

  const undo = useCallback(() => {
    if (engine && noteId) engine.agentUndo(noteId)?.undo();
  }, [engine, noteId]);

  return { agentEdit, canUndo, undo };
}
