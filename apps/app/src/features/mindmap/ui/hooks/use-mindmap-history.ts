import { useCallback, useMemo, useRef } from "react";
import type { MindmapEdge, MindmapNode, MindmapSnapshot } from "../types";

const MAX_HISTORY = 50;

export function useMindmapHistory() {
  const pastRef = useRef<MindmapSnapshot[]>([]);
  const futureRef = useRef<MindmapSnapshot[]>([]);

  const pushSnapshot = useCallback((nodes: MindmapNode[], edges: MindmapEdge[]) => {
    const snap: MindmapSnapshot = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    };
    pastRef.current = [...pastRef.current.slice(-MAX_HISTORY), snap];
    futureRef.current = [];
  }, []);

  const undo = useCallback(
    (currentNodes: MindmapNode[], currentEdges: MindmapEdge[]): MindmapSnapshot | null => {
      const past = pastRef.current;
      if (past.length === 0) return null;

      const previous = past[past.length - 1]!;
      pastRef.current = past.slice(0, -1);

      const currentSnap: MindmapSnapshot = {
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
      };
      futureRef.current = [currentSnap, ...futureRef.current];

      return previous;
    },
    [],
  );

  const redo = useCallback(
    (currentNodes: MindmapNode[], currentEdges: MindmapEdge[]): MindmapSnapshot | null => {
      const future = futureRef.current;
      if (future.length === 0) return null;

      const next = future[0]!;
      futureRef.current = future.slice(1);

      const currentSnap: MindmapSnapshot = {
        nodes: JSON.parse(JSON.stringify(currentNodes)),
        edges: JSON.parse(JSON.stringify(currentEdges)),
      };
      pastRef.current = [...pastRef.current, currentSnap];

      return next;
    },
    [],
  );

  const clear = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
  }, []);

  const canUndo = useCallback(() => pastRef.current.length > 0, []);
  const canRedo = useCallback(() => futureRef.current.length > 0, []);

  // Return a stable reference – all members are already stable useCallbacks
  return useMemo(
    () => ({ pushSnapshot, undo, redo, clear, canUndo, canRedo }),
    [pushSnapshot, undo, redo, clear, canUndo, canRedo],
  );
}
