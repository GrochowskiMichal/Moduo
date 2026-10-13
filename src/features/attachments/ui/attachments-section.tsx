// The attachments section of an item's detail panel (AT-2), self-contained so
// a panel only places it (TV-U13 rebuilds the task panel around it):
// - `useAttachmentsSection` owns the files, the drop/paste zone and the viewer;
// - spread its `dropZone` on the element that should take files (the whole
//   panel), give `dropActive` the shared `DROP_TARGET` look on the part that
//   lights up, and hand `onEditorFiles` to the description editor (Lexical
//   routes its own paste and drop, so the zone skips those);
// - `<AttachmentsSection>` draws the strip and the viewer, right under the
//   description (specs/attachments.md "Where they show").

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
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  entity: { type: "task"; id: string };
  userId: string | null;
  canEdit: boolean;
}): AttachmentsSectionState {
  const attachments = useEntityAttachments({ runtime, workspaceId, entity, userId, canEdit });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
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
    viewerIndex,
    setViewerIndex,
  };
}

/** The strip (thumbnails, file tiles, "+", upload captions) and its viewer. */
export function AttachmentsSection({
  state,
  className,
}: {
  state: AttachmentsSectionState;
  className?: string;
}) {
  const { attachments: a, acceptsFiles, available, viewerIndex, setViewerIndex } = state;
  if (!available) return null;
  return (
    <>
      <AttachmentStrip
        className={className}
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
      />
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
