// The edge style menu's writes: label, colour, shape, pattern, animation. Each
// (but the label) pushes one undo snapshot first.

import { type Dispatch, type SetStateAction, useCallback } from "react";

import type { useMindmapHistory } from "./hooks/use-mindmap-history";
import {
  withEdgeAnimation,
  withEdgeColor,
  withEdgeLabel,
  withEdgePattern,
  withEdgeShape,
} from "./mindmap-records";
import type { EdgePattern, EdgeStyle, MindmapEdge, MindmapNode } from "./types";

type Input = {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  setEdges: Dispatch<SetStateAction<MindmapEdge[]>>;
  history: ReturnType<typeof useMindmapHistory>;
};

export function useMindmapEdgeStyle({ nodes, edges, setEdges, history }: Input) {
  const updateEdgeRecord = useCallback(
    (edgeId: string, updater: (edge: MindmapEdge) => MindmapEdge) => {
      setEdges((current) => current.map((edge) => (edge.id === edgeId ? updater(edge) : edge)));
    },
    [setEdges],
  );

  const updateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      updateEdgeRecord(edgeId, (edge) => withEdgeLabel(edge, label));
    },
    [updateEdgeRecord],
  );

  const applyEdgeColor = useCallback(
    (edgeId: string, color: string, withHistory = true) => {
      if (withHistory) history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => withEdgeColor(edge, color));
    },
    [history, nodes, edges, updateEdgeRecord],
  );

  const applyEdgeShape = useCallback(
    (edgeId: string, styleValue: EdgeStyle) => {
      history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => withEdgeShape(edge, styleValue));
    },
    [history, nodes, edges, updateEdgeRecord],
  );

  const applyEdgePattern = useCallback(
    (edgeId: string, pattern: EdgePattern) => {
      history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => withEdgePattern(edge, pattern));
    },
    [history, nodes, edges, updateEdgeRecord],
  );

  const applyEdgeAnimation = useCallback(
    (edgeId: string, animated: boolean) => {
      history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => withEdgeAnimation(edge, animated));
    },
    [history, nodes, edges, updateEdgeRecord],
  );

  return { updateEdgeLabel, applyEdgeColor, applyEdgeShape, applyEdgePattern, applyEdgeAnimation };
}
