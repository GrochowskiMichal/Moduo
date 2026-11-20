/**
 * The center of the refreshed shell (specs/notes-refresh.md NR-2, AC5): the
 * top bar over one centred reading column at `--width-prose-max` (a note's
 * Full width opts out). NR-3 adds the meta line under the title and the
 * "Linked from" footer under the document.
 */

import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";

import { useNoteAnchors } from "../comments/anchor-store";
import type { NotesEditorBridge } from "../editor/notes-editor-bridge";
import type { Note } from "../model";
import { selectSubpages } from "../subpages";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { displayTitle } from "../title";
import { NoteEditor } from "../ui/note-editor";
import { NotesEditorDropZone } from "../ui/notes-editor-drop-zone";
import { LinkedFromFooter } from "./linked-from-footer";
import { META_CHIP, NoteMetaLineView } from "./note-meta-line";
import { SubpagesList } from "./subpages-list";
import { useAgentEdit } from "./use-agent-edit";
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
  bridge,
  onTitleDerived,
  onRestore,
  onUnarchive,
  onOpenEntity,
  onOpenDetail,
  onOpenComments,
  publicChip = null,
  memberName,
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
  bridge: NotesEditorBridge;
  onTitleDerived: (title: string) => void;
  onRestore: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onOpenEntity: (ref: EntityRef) => void;
  /** Open the right panel on its Detail variant (a count chip's target). */
  onOpenDetail: () => void;
  /** Open the right panel on Comments (the open-comments chip's target). */
  onOpenComments?: () => void;
  /** The meta line's "Public" chip, when the note is published. */
  publicChip?: ReactNode;
  /** A workspace member's display name, for "Edited … by …". */
  memberName?: (userId: string) => string | null;
}) {
  const liveNote = note && !note.deletedAt && !isDraft ? note : null;
  const agent = useAgentEdit({ runtime, engine, workspaceId, noteId: liveNote?.id ?? null });
  const links = useNoteLinks({
    runtime,
    workspaceId,
    note: liveNote,
    editedBy: liveNote?.editedBy ? (memberName?.(liveNote.editedBy) ?? null) : null,
    agentEdit: agent.agentEdit,
    canUndoAgent: agent.canUndo && editable,
  });
  const comments = useOpenCommentCount(liveNote?.id ?? null);
  const stateChips: Array<{ key: string; node: ReactNode }> = [];
  if (liveNote && publicChip) stateChips.push({ key: "public", node: publicChip });
  if (liveNote && comments > 0 && onOpenComments) {
    stateChips.push({
      key: "comments",
      node: (
        <button
          type="button"
          className={`${META_CHIP} flex items-center gap-1`}
          onClick={onOpenComments}
        >
          <MessageSquare aria-hidden className="size-icon-xs" />
          {comments === 1 ? "1 comment" : `${comments} comments`}
        </button>
      ),
    });
  }
  let body: ReactNode;
  if (note?.deletedAt) {
    body = (
      <div className="grid h-full place-content-center gap-3 text-center text-muted-foreground">
        <p className="text-sm">This note was deleted. It stays in Recently deleted for 30 days.</p>
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
        <NoteEditor
          key={editorNoteId}
          engine={engine}
          workspaceId={workspaceId}
          noteId={editorNoteId}
          editable={editable}
          titleForLabel={displayTitle(note?.title ?? "")}
          onTitleDerived={onTitleDerived}
          bridge={bridge}
          autoFocus={isDraft}
          fullWidth={note?.fullWidth ?? false}
          belowTitle={
            liveNote &&
            (links.line.chips.length > 0 || stateChips.length > 0 || links.line.edited) ? (
              <NoteMetaLineView
                line={links.line}
                state={stateChips}
                onOpenEntity={onOpenEntity}
                onOpenDetail={onOpenDetail}
                onUndo={agent.undo}
              />
            ) : null
          }
          footer={
            liveNote ? (
              <>
                <SubpagesList
                  subpages={selectSubpages(bridge.listNotes?.() ?? [], liveNote.id)}
                  onOpen={bridge.openNote}
                />
                <LinkedFromFooter groups={links.backlinks} onOpen={onOpenEntity} />
              </>
            ) : null
          }
        />
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
      {liveNote?.isArchived ? (
        <div className="flex items-center justify-center gap-3 border-b border-hairline px-4 py-1.5 text-xs text-muted-foreground">
          This note is archived, so it can’t be edited.
          {canEdit && onUnarchive ? (
            <Button variant="ghost" size="sm" onClick={() => onUnarchive(liveNote.id)}>
              Unarchive
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

/** Comments on the note's open threads, as the margin counts them (a thread
 * not counted yet still counts once), so the closed panel isn't the only
 * place that says the note has a conversation. */
function useOpenCommentCount(noteId: string | null): number {
  const anchors = useNoteAnchors(noteId ?? "");
  if (!noteId || !anchors.openThreads || !anchors.docOrder) return 0;
  let total = 0;
  for (const id of anchors.docOrder) {
    if (!anchors.openThreads.has(id)) continue;
    total += Math.max(1, anchors.counts?.get(id) ?? 1);
  }
  return total;
}
