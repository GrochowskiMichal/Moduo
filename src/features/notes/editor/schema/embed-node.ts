/**
 * EmbedNode: a block embed (today only mindmaps; legacy "task" embeds import
 * and render nothing). Schema only (NR-3): the view lives in
 * `../views/embed-view.tsx`, installed through the node-view registry.
 */

import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import { renderNodeView } from "../../../spine/editor/node-views";

export type SerializedEmbedNode = Spread<
  {
    kind: "mindmap" | "task";
    itemId: string;
  },
  SerializedLexicalNode
>;

export class EmbedNode extends DecoratorNode<unknown> {
  __kind: "mindmap" | "task";
  __itemId: string;

  static getType(): string {
    return "embed";
  }

  static clone(node: EmbedNode): EmbedNode {
    return new EmbedNode(node.__kind, node.__itemId, node.__key);
  }

  constructor(kind: "mindmap" | "task", itemId: string, key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__itemId = itemId;
  }

  createDOM(): HTMLElement {
    const div = document.createElement("div");
    div.className = "lexical-embed-node my-4 pointer-events-auto rounded-lg overflow-hidden";
    // contentEditable=false so the caret skips over the embed instead of
    // landing inside the rendered view.
    div.contentEditable = "false";
    return div;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  static importJSON(serializedNode: SerializedEmbedNode): EmbedNode {
    return $createEmbedNode(serializedNode.kind, serializedNode.itemId);
  }

  exportJSON(): SerializedEmbedNode {
    return {
      type: "embed",
      version: 1,
      kind: this.__kind,
      itemId: this.__itemId,
    };
  }

  decorate(): unknown {
    return renderNodeView(this);
  }
}

export function $createEmbedNode(kind: "mindmap" | "task", itemId: string): EmbedNode {
  return new EmbedNode(kind, itemId);
}

export function $isEmbedNode(node: unknown): node is EmbedNode {
  return node instanceof EmbedNode;
}
