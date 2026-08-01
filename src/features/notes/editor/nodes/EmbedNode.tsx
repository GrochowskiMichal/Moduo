import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
import type { ReactNode } from "react";
import { EmbeddedMindmap } from "./EmbeddedMindmap";

export type SerializedEmbedNode = Spread<
  {
    kind: "mindmap" | "task";
    itemId: string;
  },
  SerializedLexicalNode
>;

export class EmbedNode extends DecoratorNode<ReactNode> {
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
    // We set contentEditable to false so that the editor skips over it and cursor
    // doesn't go inside the React element
    div.contentEditable = "false";
    return div;
  }

  updateDOM(): boolean {
    return false;
  }

  static importJSON(serializedNode: SerializedEmbedNode): EmbedNode {
    const node = $createEmbedNode(serializedNode.kind, serializedNode.itemId);
    return node;
  }

  exportJSON(): SerializedEmbedNode {
    return {
      type: "embed",
      version: 1,
      kind: this.__kind,
      itemId: this.__itemId,
    };
  }

  decorate(): ReactNode {
    if (this.__kind === "mindmap") {
      return <EmbeddedMindmap mindmapId={this.__itemId} />;
    }
    // The legacy "task" embed was removed with the old tasks model; any
    // persisted task embeds import cleanly but render nothing.
    return null;
  }
}

export function $createEmbedNode(kind: "mindmap" | "task", itemId: string): EmbedNode {
  return new EmbedNode(kind, itemId);
}

export function $isEmbedNode(node: any): node is EmbedNode {
  return node instanceof EmbedNode;
}
