import { useEffect, useMemo, useRef, useState } from "react";
import type { ModuoRuntime } from "../../../../lib/runtime";
import type { NoteMeta } from "../../../notes/types";
import { extractNotePreviewFromDocState } from "../../../notes/utils/crdt-preview";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

type Props = {
  notes: NoteMeta[];
  workspaceId: string;
  runtime: ModuoRuntime | null;
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function NotesWidget({ notes, workspaceId, runtime, config, isLocked, onUpdateConfig }: Props) {
  const visibleNotes = useMemo(
    () => notes.filter((note) => !note.deletedAt && !note.isArchived && note.kind === "note"),
    [notes]
  );
  const activeNote = useMemo(
    () => visibleNotes.find((note) => note.id === config.noteId) ?? visibleNotes[0] ?? null,
    [config.noteId, visibleNotes]
  );
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewCacheRef = useRef(new Map<string, { updatedAt: string; content: string }>());

  useEffect(() => {
    if (!activeNote || !runtime || !workspaceId) {
      setContent("");
      setLoading(false);
      setError(null);
      return;
    }

    const cached = previewCacheRef.current.get(activeNote.id);
    if (cached && cached.updatedAt === activeNote.updatedAt) {
      setContent(cached.content);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent("");

    runtime.notes
      .getDocState(workspaceId, activeNote.id)
      .then((state) => {
        if (cancelled) return;
        const nextContent = extractNotePreviewFromDocState(state);
        previewCacheRef.current.set(activeNote.id, { updatedAt: activeNote.updatedAt, content: nextContent });
        setContent(nextContent);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load note content.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeNote?.id, activeNote?.updatedAt, runtime, workspaceId]);

  return (
    <WidgetShell
      config={config}
      title="Notes"
      controls={
        !isLocked ? (
          <select
            value={activeNote?.id ?? ""}
            onChange={(event) => onUpdateConfig({ noteId: event.target.value || undefined })}
            className="max-w-[65%] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none"
          >
            {visibleNotes.length === 0 ? <option value="">No notes</option> : null}
            {visibleNotes.map((note) => (
              <option key={note.id} value={note.id}>
                {note.title || "Untitled"}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {activeNote ? (
          <>
            <p className="text-[13px] font-medium text-[#f1f1f1]">{activeNote.title || "Untitled"}</p>
            <p className="mt-1 text-[11px] text-[#8a8a8a]">Updated {new Date(activeNote.updatedAt).toLocaleString()}</p>
            {loading ? <p className="mt-3 text-[12px] text-[#808080]">Loading note...</p> : null}
            {error && !loading ? <p className="mt-3 text-[12px] text-[#a06060]">{error}</p> : null}
            {!loading && !error ? (
              <p className="mt-3 whitespace-pre-wrap text-[12px] leading-[1.6] text-[#cccccc]">
                {content || "This note is empty."}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-[#808080]">No notes available in this workspace.</p>
        )}
      </div>
    </WidgetShell>
  );
}
