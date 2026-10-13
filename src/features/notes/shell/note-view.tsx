/**
 * The center of the refreshed shell (specs/notes-refresh.md NR-2, AC5): the
 * top bar over one centred reading column at `--width-prose-max` (a note's
 * Full width opts out). NR-3 adds the meta line under the title and the
 * "Linked from" footer under the document.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import type { NotesEditorBridge } from "../editor/notes-editor-bridge";
import type { Note } from "../model";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { displayTitle } from "../title";
import { NoteEditor } from "../ui/note-editor";
import { NotesEditorDropZone } from "../ui/notes-editor-drop-zone";
import { LinkedFromFooter } from "./linked-from-footer";
import { NoteMetaLineView } from "./note-meta-line";
import { useNoteLinks } from "./use-note-links";

export function NoteView({
  topBar,
  runtime,
  engine,
  workspaceId,
  editorNoteId,
  note,
  isDraft,
  editable,
  degraded,
  loading,
  canEdit,
  seedWelcome,
  bridge,
  onTitleDerived,
  onRestore,
  onOpenEntity,
  onOpenDetail,
}: {
  topBar: ReactNode;
  runtime: ModuoRuntime | null;
  engine: NotesSyncEngineV2 | null;
  workspaceId: string;
  /** The note the editor shows: a live note or the open draft. */
  editorNoteId: string | null;
  /** The open note's meta (null for a draft). */
  note: Note | null;
  isDraft: boolean;
  editable: boolean;
  degraded: boolean;
  loading: boolean;
  canEdit: boolean;
  seedWelcome: boolean;
  bridge: NotesEditorBridge;
  onTitleDerived: (title: string) => void;
  onRestore: (id: string) => void;
  onOpenEntity: (ref: EntityRef) => void;
  /** Open the right panel on its Detail variant (a count chip's target). */
  onOpenDetail: () => void;
}) {
  const liveNote = note && !note.deletedAt && !isDraft ? note : null;
  const links = useNoteLinks({ runtime, workspaceId, note: liveNote });
  let body: ReactNode;
  if (note?.deletedAt) {
    body = (
      <div className="grid h-full place-content-center gap-3 text-center text-muted-foreground">
        <p className="text-sm">This note is in the Trash.</p>
        {canEdit ? (
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-center"
            onClick={() => onRestore(note.id)}
          >
            Restore
          </Button>
        ) : null}
      </div>
    );
  } else if (editorNoteId && engine) {
    body = (
      <NotesEditorDropZone noteId={isDraft ? null : editorNoteId} editable={editable}>
        <div
          className={cn(
            "mx-auto h-full min-h-0 w-full",
            note?.fullWidth ? "max-w-none" : "max-w-(--width-prose-max)",
          )}
        >
          <NoteEditor
            key={editorNoteId}
            engine={engine}
            workspaceId={workspaceId}
            noteId={editorNoteId}
            editable={editable}
            titleForLabel={displayTitle(note?.title ?? "")}
            onTitleDerived={onTitleDerived}
            seedWelcome={seedWelcome}
            bridge={bridge}
            autoFocus={isDraft}
            bare
            belowTitle={
              liveNote ? (
                <NoteMetaLineView
                  line={links.line}
                  onOpenEntity={onOpenEntity}
                  onOpenDetail={onOpenDetail}
                />
              ) : null
            }
            footer={
              liveNote ? <LinkedFromFooter groups={links.backlinks} onOpen={onOpenEntity} /> : null
            }
          />
        </div>
      </NotesEditorDropZone>
    );
  } else {
    body = (
      <div className="grid h-full place-content-center gap-1 text-center text-muted-foreground">
        {loading ? null : (
          <>
            <p className="font-display text-lg text-foreground">Write something down</p>
            <p className="text-sm">
              Pick a note on the left{canEdit ? ", or press ⌘N for a fresh one" : ""}.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {degraded ? (
        <div className="border-b border-hairline px-4 py-1.5 text-xs text-muted-foreground">
          Notes is waiting on a server update — reading is fine, editing comes back shortly.
        </div>
      ) : null}
      {topBar}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
