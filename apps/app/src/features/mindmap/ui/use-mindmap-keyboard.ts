// Mindmap keys: ⌘/Ctrl held switches the canvas to panning; ⌘Z / ⇧⌘Z undo and
// redo; N new node, ⌘D duplicate, Tab child, Enter sibling, ⌫/Delete remove,
// Esc clear. Never from a text field (undo and redo aside).

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import type { EdgeMenuState } from "./edge-style";
import type { MindmapNode } from "./types";

type Input = {
  handleUndo: () => void;
  handleRedo: () => void;
  addNode: () => void;
  addChildNode: () => void;
  addSiblingNode: () => void;
  duplicateSelectedNode: () => void;
  duplicateSelection: () => void;
  deleteSelectedNode: () => void;
  deleteSelectedEdge: () => void;
  deleteSelection: () => void;
  selectedNode: MindmapNode | null;
  selectedEdgeId: string | null;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  edgeMenu: EdgeMenuState | null;
  setEdgeMenu: Dispatch<SetStateAction<EdgeMenuState | null>>;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
  setSelectedNode: Dispatch<SetStateAction<MindmapNode | null>>;
};

/** Returns whether ⌘/Ctrl is held (the canvas pans instead of dragging nodes). */
export function useMindmapKeyboard({
  handleUndo,
  handleRedo,
  addNode,
  addChildNode,
  addSiblingNode,
  duplicateSelectedNode,
  duplicateSelection,
  deleteSelectedNode,
  deleteSelectedEdge,
  deleteSelection,
  selectedNode,
  selectedEdgeId,
  selectedNodeIds,
  selectedEdgeIds,
  edgeMenu,
  setEdgeMenu,
  setSelectedEdgeId,
  setSelectedNode,
}: Input): boolean {
  const [isCommandMode, setIsCommandMode] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onModifierChange = (event: KeyboardEvent) => {
      setIsCommandMode(event.metaKey || event.ctrlKey);
    };
    const onModifierUp = () => setIsCommandMode(false);
    window.addEventListener("keydown", onModifierChange);
    window.addEventListener("keyup", onModifierChange);
    window.addEventListener("blur", onModifierUp);
    return () => {
      window.removeEventListener("keydown", onModifierChange);
      window.removeEventListener("keyup", onModifierChange);
      window.removeEventListener("blur", onModifierUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Undo
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo
      if (meta && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (isInput) return;

      // N → add new node
      if (!meta && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        addNode();
        return;
      }

      // Cmd/Ctrl + D → duplicate selected node
      if (meta && (e.key === "d" || e.key === "D")) {
        if (selectedNode || selectedNodeIds.size > 0 || selectedEdgeIds.size > 0) {
          e.preventDefault();
          duplicateSelection();
        }
        return;
      }

      // Tab → add child
      if (e.key === "Tab" && selectedNode) {
        e.preventDefault();
        addChildNode();
        return;
      }

      // Enter → add sibling
      if (e.key === "Enter" && selectedNode) {
        e.preventDefault();
        addSiblingNode();
        return;
      }

      // Delete / Backspace → remove selected node/edge
      if (e.key === "Delete" || e.key === "Backspace") {
        if (e.key === "Backspace") e.preventDefault();
        if (selectedNodeIds.size > 0 || selectedEdgeIds.size > 0) {
          e.preventDefault();
          deleteSelection();
          return;
        }
        if (selectedNode) {
          e.preventDefault();
          deleteSelectedNode();
          return;
        }
        if (selectedEdgeId) {
          e.preventDefault();
          deleteSelectedEdge();
          return;
        }
        return;
      }

      // Escape
      if (e.key === "Escape") {
        if (edgeMenu) {
          setEdgeMenu(null);
          return;
        }
        if (selectedEdgeId) {
          setSelectedEdgeId(null);
          return;
        }
        setSelectedNode(null);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    addNode,
    selectedNode,
    selectedEdgeId,
    addChildNode,
    addSiblingNode,
    duplicateSelectedNode,
    duplicateSelection,
    deleteSelectedNode,
    deleteSelectedEdge,
    deleteSelection,
    edgeMenu,
    selectedNodeIds,
    selectedEdgeIds,
  ]);

  return isCommandMode;
}
