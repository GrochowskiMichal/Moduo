// The Reference node's view for Lexical prose (RF-1, tasks-v3 Assumptions
// #13): the Reference primitive (link · chip · card, hover preview, live
// facts, "Private item", "Deleted task") drawn for the spine's entity-ref
// node, plus "Show as" right after an insert.
//
// The node's schema (fields, JSON version 2, HTML round trip) lives React-free
// in ../editor/entity-ref-schema.ts (NR-3 schema/view split), so headless
// editors load it without this file. A browser editor installs this view
// through the node-view registry: importing this module does it once.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";
import { useEffect, useSyncExternalStore } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";
import { $isReferenceNode, ReferenceNode } from "../editor/entity-ref-schema";
import { registerNodeView } from "../editor/node-views";
import { referenceKind } from "./kinds";
import type { ReferenceDisplay } from "./types";
import { Reference, ShowAs } from "./ui/reference";

export {
  $createReferenceNode,
  $isReferenceNode,
  ENTITY_REF_ATTR,
  ReferenceNode,
  type SerializedReferenceNode,
} from "../editor/entity-ref-schema";

/** Lexical updates that only change a reference's display (they don't dismiss "Show as"). */
export const REFERENCE_DISPLAY_TAG = "reference-display";

/** Draw every entity-ref node as the Reference primitive. Idempotent. */
export function installReferenceView(): void {
  registerNodeView(ReferenceNode.getType(), (node) => {
    const ref = node as ReferenceNode;
    return (
      <ReferenceDecorator
        nodeKey={ref.getKey()}
        type={ref.__entityType}
        id={ref.__entityId}
        display={ref.__display}
        label={ref.__label}
      />
    );
  });
}

installReferenceView();

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
