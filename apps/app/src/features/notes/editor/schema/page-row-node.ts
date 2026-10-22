/**
 * PageRowNode (Wave-3 NO-4, AC2/AC5) — the Notion-style child-page mirror
 * block. Renders the child note's live title/icon (via the editor bridge) and
 * opens it on click. Deleting the row deletes ONLY the mirror — the child
 * note stays in the tree (DESIGN_BRIEF §3c). Serializes as
 * `[title](moduo://note/<id>)` on its own line in markdown.
 *
 * Schema only (NR-3): the row view lives in `../views/page-row-view.tsx`.
 */

import {
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import { renderNodeView } from "../../../spine/editor/node-views";

export type SerializedPageRowNode = Spread<
  {
    noteId: string;
    /** Snapshot label for surfaces without the bridge (md export, tombstone). */
    label: string;
  },
  SerializedLexicalNode
>;

export class PageRowNode extends DecoratorNode<unknown> {
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

  /** The plain-text projection reads the row's title, not a blank. */
  getTextContent(): string {
    return this.getLatest().__label;
  }

  decorate(): unknown {
    return renderNodeView(this);
  }
}

export function $createPageRowNode(noteId: string, label: string): PageRowNode {
  return new PageRowNode(noteId, label);
}

export function $isPageRowNode(node: LexicalNode | null | undefined): node is PageRowNode {
  return node instanceof PageRowNode;
}
