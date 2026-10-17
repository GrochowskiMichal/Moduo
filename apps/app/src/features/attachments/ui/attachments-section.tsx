// The attachments section of an item's detail panel (AT-2), self-contained so
// a panel only places it (TV-U13 rebuilds the task panel around it):
// - `useAttachmentsSection` owns the files, the drop/paste zone and the viewer;
// - spread its `dropZone` on the element that should take files (the whole
//   panel), give `dropActive` the shared `DROP_TARGET` look on the part that
//   lights up, and hand `onEditorFiles` to the description editor (Lexical
//   routes its own paste and drop, so the zone skips those);
// - `<AttachmentsSection>` draws the strip and the viewer, right under the
//   description (specs/attachments.md "Where they show"), and the file
//   picker, so `openPicker` works from a menu ("Attach files…") even while
//   the strip is hidden (no files yet, MOD-115).

import type React from "react";
import { useRef, useState } from "react";
import { dispatchOpenSettings } from "@/features/settings/settings-events";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { dragHasFiles, filesFromDataTransfer, pastedFiles } from "../files";
import { type EntityAttachments, useEntityAttachments } from "../hooks/use-attachments";
import { AttachmentStrip } from "./attachment-strip";
import { AttachmentViewer } from "./attachment-viewer";

export type AttachmentsDropZone = Pick<
  React.HTMLAttributes<HTMLElement>,
  "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop" | "onPaste" | "tabIndex"
>;

export type AttachmentsSectionState = {
  runtime: ModuoRuntime | null;
  attachments: EntityAttachments;
  /** Files can be added here (edit access, signed in, a workspace). */
  acceptsFiles: boolean;
  /** Draw nothing without a runtime or workspace (Storybook, signed out). */
  available: boolean;
  /** A file drag is over the zone. */
  dropActive: boolean;
  dropZone: AttachmentsDropZone;
  /** For the description editor's `onFiles`; undefined when files can't be added. */
  onEditorFiles: ((files: File[]) => void) | undefined;
  /** Opens the file picker (the "+" tile, ⋯ → Attach files…); undefined when files can't be added. */
  openPicker: (() => void) | undefined;
  /** The picker's input, which `<AttachmentsSection>` renders. */
  pickerRef: React.RefObject<HTMLInputElement | null>;
  viewerIndex: number | null;
  setViewerIndex: (index: number | null) => void;
};

/** Inside a Lexical editor, which routes its own files (gotchas/notes.md). */
function inTextEditor(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("[data-lexical-editor]");
}

export function useAttachmentsSection({
  runtime,
  workspaceId,
  entity,
  userId,
  canEdit,
  refreshStamp,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  entity: { type: "task"; id: string };
  userId: string | null;
  canEdit: boolean;
  /** The entity's file stamp from the shared store (AT-3): the strip re-reads on it. */
  refreshStamp?: string | null;
}): AttachmentsSectionState {
  const attachments = useEntityAttachments({
    runtime,
    workspaceId,
    entity,
    userId,
    canEdit,
    refreshStamp,
  });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  const available = !!runtime && !!workspaceId;
  const acceptsFiles = canEdit && available;
  const endDrag = () => {
    dragDepth.current = 0;
    setDropActive(false);
  };

  const dropZone: AttachmentsDropZone = {
    // A click on blank space focuses the zone (not the page body), so ⌘V
    // right after reaches it. Out of the Tab order.
    tabIndex: -1,
    onDragEnter: (e) => {
      if (!acceptsFiles || !dragHasFiles(e.dataTransfer)) return;
      dragDepth.current += 1;
      setDropActive(true);
    },
    onDragOver: (e) => {
      if (!acceptsFiles || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      if (!dropActive) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) endDrag();
    },
    onDrop: (e) => {
      endDrag();
      if (!acceptsFiles || inTextEditor(e.target)) return;
      const files = filesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      attachments.addFiles(files);
    },
    onPaste: (e) => {
      if (!acceptsFiles || inTextEditor(e.target)) return;
      const files = pastedFiles(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      attachments.addFiles(files);
    },
  };

  return {
    runtime,
    attachments,
    acceptsFiles,
    available,
    dropActive,
    dropZone,
    onEditorFiles: acceptsFiles ? attachments.addFiles : undefined,
    openPicker: acceptsFiles ? () => pickerRef.current?.click() : undefined,
    pickerRef,
    viewerIndex,
    setViewerIndex,
  };
}

/** The strip (thumbnails, file tiles, "+", upload captions) and its viewer. */
export function AttachmentsSection({
  state,
  addTile,
  className,
}: {
  state: AttachmentsSectionState;
  /** When the "+" tile shows (the strip's `addTile`); a drag over the zone always shows it. */
  addTile?: "always" | "with-files";
  className?: string;
}) {
  const { attachments: a, acceptsFiles, available, viewerIndex, setViewerIndex } = state;
  if (!available) return null;
  return (
    <>
      <AttachmentStrip
        className={className}
        addTile={addTile}
        dropping={state.dropActive}
        onPickFiles={state.openPicker}
        records={a.records}
        previews={a.previews}
        uploads={a.uploads}
        almostFull={a.almostFull}
        canEdit={acceptsFiles}
        isOwner={a.isOwner}
        onAddFiles={a.addFiles}
        onOpen={setViewerIndex}
        onRetry={a.retry}
        onDismiss={a.dismiss}
        onDismissAlmostFull={a.dismissAlmostFull}
        onUpgrade={() => dispatchOpenSettings({ section: "billing" })}
        // The largest-files list (AT-3): delete what's no longer needed.
        onFreeUpSpace={() => dispatchOpenSettings({ section: "storage" })}
      />
      {acceptsFiles ? (
        <input
          ref={state.pickerRef}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          aria-hidden
          data-slot="attachment-picker"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length > 0) a.addFiles(files);
          }}
        />
      ) : null}
      <AttachmentViewer
        runtime={state.runtime}
        records={a.records}
        previews={a.previews}
        index={viewerIndex}
        onIndexChange={setViewerIndex}
        canEdit={acceptsFiles}
        onDelete={a.remove}
      />
    </>
  );
}
