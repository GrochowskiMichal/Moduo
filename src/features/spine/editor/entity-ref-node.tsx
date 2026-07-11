// Connective-tissue spine — the Lexical EntityRefNode (block CT-4).
//
// The live-rendering ref inside a Lexical editor: an inline DecoratorNode that
// renders the neutral `EntityRefChip` and deep-links on click. Persists the
// entity address `{entityType, entityId}` (DESIGN_BRIEF Component Inventory),
// plus a denormalized `label`/`icon` snapshot so it paints immediately and
// survives offline; a live registry re-resolution is a future seam. Mirrors the
// notes `EmbedNode` pattern, but inline. Clicking dispatches a
// `moduo:entity:open` event so the host (any module) can route to the hub.

import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { ReactNode } from "react";
import { EntityRefChip } from "../ui/entity-ref-chip";

/** Marker attribute stamped on the exported `<span>` so `importDOM` (and any
 * HTML-round-trip surface: email compose, task/event descriptions) can recover
 * the ref. The entity address rides denormalized data-attributes; the visible
 * label is the span's text so non-Moduo readers (an email recipient) still see
 * a readable word rather than an empty chip. */
const ENTITY_REF_ATTR = "data-lexical-entity-ref";

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

  // The chip contributes its label to the editor's plain-text projection —
  // so a derived `text` body (email alt-part, machine/MCP reads) reads the
  // entity's name rather than a blank where the decorator sits.
  getTextContent(): string {
    return this.__label;
  }

  static importJSON(serialized: SerializedEntityRefNode): EntityRefNode {
    return $createEntityRefNode({
      entityType: serialized.entityType,
      entityId: serialized.entityId,
      label: serialized.label,
      icon: serialized.icon ?? null,
    });
  }

  // HTML round-trip (DF-23): the chip persists as an inert `<span>` so it
  // survives `$generateHtmlFromNodes` (email compose + the HTML-stored task /
  // event descriptions) and re-hydrates via `$generateNodesFromDOM`.
  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (!node.hasAttribute(ENTITY_REF_ATTR)) return null;
        return { conversion: convertEntityRefElement, priority: 2 };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const span = document.createElement("span");
    span.setAttribute(ENTITY_REF_ATTR, "true");
    span.setAttribute("data-entity-type", this.__entityType);
    span.setAttribute("data-entity-id", this.__entityId);
    if (this.__icon) span.setAttribute("data-entity-icon", this.__icon);
    // Label as text → readable if the span is ever flattened / read by a
    // non-Moduo client (a sent email); the chrome is re-applied on import.
    span.textContent = this.__label;
    return { element: span };
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

function convertEntityRefElement(node: HTMLElement): DOMConversionOutput {
  const entityType = node.getAttribute("data-entity-type") ?? "";
  const entityId = node.getAttribute("data-entity-id") ?? "";
  // A malformed marker (missing address) can't resolve — drop back to plain
  // text rather than minting a dead chip.
  if (!entityType || !entityId) return { node: null };
  return {
    node: $createEntityRefNode({
      entityType,
      entityId,
      label: node.textContent ?? entityType,
      icon: node.getAttribute("data-entity-icon"),
    }),
  };
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
