// The Reference node for Lexical prose (RF-1, tasks-v3 Assumptions #13): an
// inline decorator holding `{entityType, entityId, display}` and rendering the
// Reference primitive (link · chip · card, hover preview, live facts,
// "Private item", "Deleted task").
//
// It is the spine's entity-ref node grown in place (type "entity-ref", JSON
// version 2), so Notes' documents, the materializer and every HTML surface
// keep reading their old chips: a version-1 node is a chip. What changed:
// - `display` (link | chip | card) is stored, chip by default;
// - the title is never trusted: the node renders what the reader may see, and
//   surfaces that care about privacy (task descriptions) store no label at all
//   (an older chip's label is shown only outside the app shell, where nothing
//   can resolve it);
// - a card stays an inline node (Lexical's inline-ness never follows display)
//   and its DOM span is a block, so it sits alone on its line.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import {
  $getNodeByKey,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";
import { referenceKind, referenceNoun } from "./kinds";
import { isReferenceDisplay, type ReferenceDisplay } from "./types";
import { Reference, ShowAs } from "./ui/reference";

/** The marker on the exported `<span>` (the HTML a task description stores). */
export const ENTITY_REF_ATTR = "data-lexical-entity-ref";
/** Marks a span written without a label (version 2): its text is only the type's word. */
const NO_LABEL_ATTR = "data-ref-v";

export type SerializedReferenceNode = Spread<
  {
    entityType: string;
    entityId: string;
    /** Version 1 nodes always carry one; version 2 only where a host stores titles. */
    label: string;
    icon: string | null;
    display?: ReferenceDisplay;
  },
  SerializedLexicalNode
>;

/** Lexical updates that only change a reference's display (they don't dismiss "Show as"). */
export const REFERENCE_DISPLAY_TAG = "reference-display";

export class ReferenceNode extends DecoratorNode<ReactNode> {
  __entityType: string;
  __entityId: string;
  __label: string;
  __icon: string | null;
  __display: ReferenceDisplay;

  static getType(): string {
    return "entity-ref";
  }

  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(
      node.__entityType,
      node.__entityId,
      node.__label,
      node.__icon,
      node.__display,
      node.__key,
    );
  }

  constructor(
    entityType: string,
    entityId: string,
    label = "",
    icon: string | null = null,
    display: ReferenceDisplay = "chip",
    key?: NodeKey,
  ) {
    super(key);
    this.__entityType = entityType;
    this.__entityId = entityId;
    this.__label = label;
    this.__icon = icon;
    this.__display = display;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    // A card is alone on its line; a link and a chip run with the text.
    span.className = this.__display === "card" ? "lexical-entity-ref block" : "lexical-entity-ref";
    // The caret skips over it (like EmbedNode).
    span.contentEditable = "false";
    return span;
  }

  updateDOM(prev: ReferenceNode): boolean {
    return prev.__display !== this.__display;
  }

  isInline(): boolean {
    return true;
  }

  /**
   * The plain-text projection: an older chip's label where a host stores one
   * (a sent email's text part reads the name); otherwise nothing, so no title
   * reaches a text column or a search index.
   */
  getTextContent(): string {
    return this.__label;
  }

  getDisplay(): ReferenceDisplay {
    return this.getLatest().__display;
  }

  setDisplay(display: ReferenceDisplay): void {
    const self = this.getWritable();
    self.__display = display;
  }

  /** Forget a stored title and icon (privacy-first surfaces drop old chips' labels). */
  dropStoredLabel(): void {
    if (!this.__label && !this.__icon) return;
    const self = this.getWritable();
    self.__label = "";
    self.__icon = null;
  }

  static importJSON(serialized: SerializedReferenceNode): ReferenceNode {
    return $createReferenceNode({
      entityType: serialized.entityType,
      entityId: serialized.entityId,
      label: serialized.label ?? "",
      icon: serialized.icon ?? null,
      display: isReferenceDisplay(serialized.display) ? serialized.display : "chip",
    });
  }

  exportJSON(): SerializedReferenceNode {
    return {
      type: "entity-ref",
      version: 2,
      entityType: this.__entityType,
      entityId: this.__entityId,
      label: this.__label,
      icon: this.__icon,
      display: this.__display,
    };
  }

  // HTML round trip (DF-23): the reference persists as an inert `<span>` in
  // the HTML a task or event description stores. A span written without a
  // label holds only the type's word, so an older build still shows something.
  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (!node.hasAttribute(ENTITY_REF_ATTR)) return null;
        return { conversion: convertReferenceElement, priority: 2 };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const span = document.createElement("span");
    span.setAttribute(ENTITY_REF_ATTR, "true");
    span.setAttribute("data-entity-type", this.__entityType);
    span.setAttribute("data-entity-id", this.__entityId);
    if (this.__icon) span.setAttribute("data-entity-icon", this.__icon);
    if (this.__display !== "chip") span.setAttribute("data-display", this.__display);
    if (this.__label) {
      span.textContent = this.__label;
    } else {
      span.setAttribute(NO_LABEL_ATTR, "2");
      span.textContent = referenceNoun(referenceKind(this.__entityType));
    }
    return { element: span };
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return (
      <ReferenceDecorator
        nodeKey={this.__key}
        type={this.__entityType}
        id={this.__entityId}
        display={this.__display}
        label={this.__label}
      />
    );
  }
}

function convertReferenceElement(node: HTMLElement): DOMConversionOutput {
  const entityType = node.getAttribute("data-entity-type") ?? "";
  const entityId = node.getAttribute("data-entity-id") ?? "";
  // A marker without an address can't resolve: back to plain text.
  if (!entityType || !entityId) return { node: null };
  const display = node.getAttribute("data-display");
  return {
    node: $createReferenceNode({
      entityType,
      entityId,
      label: node.hasAttribute(NO_LABEL_ATTR) ? "" : (node.textContent ?? ""),
      icon: node.getAttribute("data-entity-icon"),
      display: isReferenceDisplay(display) ? display : "chip",
    }),
  };
}

export function $createReferenceNode(input: {
  entityType: string;
  entityId: string;
  label?: string;
  icon?: string | null;
  display?: ReferenceDisplay;
}): ReferenceNode {
  return new ReferenceNode(
    input.entityType,
    input.entityId,
    input.label ?? "",
    input.icon ?? null,
    input.display ?? "chip",
  );
}

export function $isReferenceNode(node: unknown): node is ReferenceNode {
  return node instanceof ReferenceNode;
}

// ── "Show as", right after inserting ─────────────────────────────────────────
// The inserting plugin marks the new node; its decorator anchors "Show as:
// Link · Chip · Card" to itself until the next keystroke (like Notion's paste
// menu). Later the choice lives in the hover card.

const justInserted = new WeakMap<LexicalEditor, NodeKey>();
const insertListeners = new Set<() => void>();

function bumpInserted() {
  for (const fn of insertListeners) fn();
}

/** Offer "Show as" on this freshly inserted node until the next keystroke. */
export function markJustInserted(editor: LexicalEditor, key: NodeKey): void {
  justInserted.set(editor, key);
  bumpInserted();
}

function clearJustInserted(editor: LexicalEditor): void {
  if (!justInserted.has(editor)) return;
  justInserted.delete(editor);
  bumpInserted();
}

function subscribeInserted(fn: () => void): () => void {
  insertListeners.add(fn);
  return () => insertListeners.delete(fn);
}

/** Whether this node is the one just inserted (the answer is the snapshot: compiler-safe). */
function useJustInserted(editor: LexicalEditor, key: NodeKey): boolean {
  return useSyncExternalStore(
    subscribeInserted,
    () => justInserted.get(editor) === key,
    () => false,
  );
}

function ReferenceDecorator({
  nodeKey,
  type,
  id,
  display,
  label,
}: {
  nodeKey: NodeKey;
  type: string;
  id: string;
  display: ReferenceDisplay;
  label: string;
}) {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const offering = useJustInserted(editor, nodeKey) && editable;

  // The next keystroke (any text change) puts "Show as" away.
  useEffect(() => {
    if (!offering) return;
    return editor.registerUpdateListener(({ dirtyLeaves, tags }) => {
      if (tags.has(REFERENCE_DISPLAY_TAG)) return;
      if (dirtyLeaves.size > 0) clearJustInserted(editor);
    });
  }, [editor, offering]);

  const setDisplay = (next: ReferenceDisplay) => {
    editor.update(
      () => {
        const node = $getNodeByKey(nodeKey);
        if ($isReferenceNode(node)) node.setDisplay(next);
      },
      { tag: REFERENCE_DISPLAY_TAG },
    );
  };

  const reference = (
    <Reference
      type={type}
      id={id}
      display={display}
      fallbackLabel={label || null}
      onDisplayChange={editable ? setDisplay : undefined}
    />
  );
  if (!offering) return reference;
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) clearJustInserted(editor);
      }}
    >
      <PopoverAnchor asChild>
        <span className={display === "card" ? "block" : "inline"}>{reference}</span>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-auto px-2.5 py-1.5"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ShowAs
          value={display}
          kind={referenceKind(type)}
          onChange={(next) => {
            setDisplay(next);
            clearJustInserted(editor);
            editor.focus();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
