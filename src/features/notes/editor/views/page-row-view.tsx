/**
 * The page-row view (NR-3 schema/view split): draws a `PageRowNode` as the
 * child note's live title/icon and opens it on click.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, type NodeKey } from "lexical";
import { ChevronRight, FileText } from "lucide-react";
import { useEffect } from "react";
import { displayTitle } from "../../title";
import { useNotesEditorBridge } from "../notes-editor-bridge";
import { $isPageRowNode } from "../schema/page-row-node";

export function PageRowView({
  nodeKey,
  noteId,
  label,
}: {
  nodeKey: NodeKey;
  noteId: string;
  label: string;
}) {
  const [editor] = useLexicalComposerContext();
  const bridge = useNotesEditorBridge();
  const meta = bridge?.getNoteMeta(noteId) ?? null;
  const title = meta ? displayTitle(meta.title) : label || "Untitled";
  const trashed = Boolean(meta?.deletedAt);

  // Reconcile the PERSISTED label to the live title — md export/copy read
  // __label, and without this every row minted before its child was titled
  // exports "[Untitled](…)" forever. Edit-gated (a viewer must not write).
  useEffect(() => {
    if (!meta || trashed || !editor.isEditable()) return;
    const live = displayTitle(meta.title);
    if (live === label) return;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isPageRowNode(node) && node.getLabel() !== live) {
        node.setLabel(live);
      }
    });
  }, [editor, nodeKey, meta, trashed, label]);

  return (
    <button
      type="button"
      onClick={() => bridge?.openNote(noteId)}
      disabled={!bridge}
      className="group my-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-base text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      {meta?.icon ? (
        <span className="w-5 text-center leading-none">{meta.icon}</span>
      ) : (
        <FileText className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span
        className={
          trashed
            ? "truncate text-muted-foreground line-through"
            : "truncate underline decoration-border underline-offset-4 group-hover:decoration-foreground"
        }
      >
        {title}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
    </button>
  );
}
