/**
 * PageRowNode (Wave-3 NO-4, AC2/AC5) — the Notion-style child-page mirror
 * block. Renders the child note's live title/icon (via the editor bridge) and
 * opens it on click. Deleting the row deletes ONLY the mirror — the child
 * note stays in the tree (DESIGN_BRIEF §3c). Serializes as
 * `[title](moduo://note/<id>)` on its own line in markdown.
 */

import { useEffect, type ReactNode } from "react";
import { ChevronRight, FileText } from "lucide-react";
import {
  $getNodeByKey,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useNotesEditorBridge } from "../notes-editor-bridge";
import { displayTitle } from "../../title";

export type SerializedPageRowNode = Spread<
  {
    noteId: string;
    /** Snapshot label for surfaces without the bridge (md export, tombstone). */
    label: string;
  },
  SerializedLexicalNode
>;

function PageRowComponent({
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

export class PageRowNode extends DecoratorNode<ReactNode> {
  __noteId: string;
  __label: string;

  static getType(): string {
    return "page-row";
  }

  static clone(node: PageRowNode): PageRowNode {
    return new PageRowNode(node.__noteId, node.__label, node.__key);
  }

  constructor(noteId: string, label: string, key?: NodeKey) {
    super(key);
    this.__noteId = noteId;
    this.__label = label;
  }

  static importJSON(serialized: SerializedPageRowNode): PageRowNode {
    return $createPageRowNode(serialized.noteId, serialized.label ?? "");
  }

  exportJSON(): SerializedPageRowNode {
    return {
      type: "page-row",
      version: 1,
      noteId: this.__noteId,
      label: this.__label,
    };
  }

  getNoteId(): string {
    return this.__noteId;
  }

  getLabel(): string {
    return this.getLatest().__label;
  }

  setLabel(label: string): void {
    this.getWritable().__label = label;
  }

  createDOM(): HTMLElement {
    const el = document.createElement("div");
    el.contentEditable = "false";
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  decorate(): ReactNode {
    return <PageRowComponent nodeKey={this.__key} noteId={this.__noteId} label={this.__label} />;
  }
}

export function $createPageRowNode(noteId: string, label: string): PageRowNode {
  return new PageRowNode(noteId, label);
}

export function $isPageRowNode(node: LexicalNode | null | undefined): node is PageRowNode {
  return node instanceof PageRowNode;
}
