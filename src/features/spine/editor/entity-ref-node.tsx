// Connective-tissue spine — the Lexical entity-ref node (block CT-4).
//
// The inline node an `@mention` / `/ref` inserts. An INLINE DecoratorNode
// (isInline → true) so it sits among words on the baseline; it renders the
// neutral {@link EntityRefChip}. Serializable so a note/comment persists its
// refs and round-trips. Mirrors the EmbedNode DecoratorNode pattern in
// src/features/notes/editor/nodes/EmbedNode.tsx. `getTextContent` returns the
// label so copy/paste degrades gracefully to plain text.

import {
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { ReactNode } from "react";
import { EntityRefChip } from "../ui/entity-ref-chip";

export type SerializedEntityRefNode = Spread<
  {
    entityType: string;
    entityId: string;
    label: string;
    icon: string | null;
  },
  SerializedLexicalNode
>;

export class EntityRefNode extends DecoratorNode<ReactNode> {
  __entityType: string;
  __entityId: string;
  __label: string;
  __icon: string | null;

  static getType(): string {
    return "entity-ref";
  }

  static clone(node: EntityRefNode): EntityRefNode {
    return new EntityRefNode(node.__entityType, node.__entityId, node.__label, node.__icon, node.__key);
  }

  constructor(
    entityType: string,
    entityId: string,
    label: string,
    icon: string | null = null,
    key?: NodeKey,
  ) {
    super(key);
    this.__entityType = entityType;
    this.__entityId = entityId;
    this.__label = label;
    this.__icon = icon;
  }

  // Inline so the chip flows with surrounding text rather than as a block.
  isInline(): boolean {
    return true;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "spine-entity-ref align-baseline";
    // Skip the caret over the chip — it's an atomic token, not editable text.
    span.contentEditable = "false";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const span = document.createElement("span");
    span.setAttribute("data-entity-type", this.__entityType);
    span.setAttribute("data-entity-id", this.__entityId);
    span.textContent = this.__label;
    return { element: span };
  }

  static importJSON(serialized: SerializedEntityRefNode): EntityRefNode {
    return $createEntityRefNode({
      entityType: serialized.entityType,
      entityId: serialized.entityId,
      label: serialized.label,
      icon: serialized.icon ?? null,
    });
  }

  exportJSON(): SerializedEntityRefNode {
    return {
      type: "entity-ref",
      version: 1,
      entityType: this.__entityType,
      entityId: this.__entityId,
      label: this.__label,
      icon: this.__icon,
    };
  }

  getTextContent(): string {
    return this.__label;
  }

  decorate(): ReactNode {
    return <EntityRefChip entityType={this.__entityType} label={this.__label} icon={this.__icon} />;
  }
}

export function $createEntityRefNode(input: {
  entityType: string;
  entityId: string;
  label: string;
  icon?: string | null;
}): EntityRefNode {
  return new EntityRefNode(input.entityType, input.entityId, input.label, input.icon ?? null);
}

export function $isEntityRefNode(node: LexicalNode | null | undefined): node is EntityRefNode {
  return node instanceof EntityRefNode;
}
