// Connective-tissue spine — the Lexical EntityRefNode (block CT-4).
//
// The live-rendering ref inside a Lexical editor: an inline DecoratorNode that
// renders the neutral `EntityRefChip` and deep-links on click. Persists the
// entity address `{entityType, entityId}` (DESIGN_BRIEF Component Inventory),
// plus a denormalized `label`/`icon` snapshot so it paints immediately and
// survives offline; a live registry re-resolution is a future seam. Mirrors the
// notes `EmbedNode` pattern, but inline. Clicking dispatches a
// `moduo:entity:open` event so the host (any module) can route to the hub.

import { DecoratorNode, type NodeKey, type SerializedLexicalNode, type Spread } from "lexical";
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
    return new EntityRefNode(
      node.__entityType,
      node.__entityId,
      node.__label,
      node.__icon,
      node.__key,
    );
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

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "lexical-entity-ref";
    // contentEditable=false so the caret skips over the chip (mirrors EmbedNode).
    span.contentEditable = "false";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return true;
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

  decorate(): ReactNode {
    const { __entityType: type, __entityId: id, __label: label, __icon: icon } = this;
    return (
      <EntityRefChip
        type={type}
        label={label}
        icon={icon}
        onClick={() => {
          if (typeof window === "undefined") return;
          window.dispatchEvent(
            new CustomEvent("moduo:entity:open", { detail: { type, id } }),
          );
        }}
      />
    );
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

export function $isEntityRefNode(node: unknown): node is EntityRefNode {
  return node instanceof EntityRefNode;
}
