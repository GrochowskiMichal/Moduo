// The Mindmap's node and edge operations: add (free, child with Tab, sibling
// with Enter), delete, duplicate — each one undo snapshot — and the node
// update/delete events the custom node fires.

import type { useReactFlow } from "@xyflow/react";
import { type Dispatch, type SetStateAction, useCallback, useEffect } from "react";

import type { EdgeMenuState } from "./edge-style";
import type { useMindmapHistory } from "./hooks/use-mindmap-history";
import { createConnectionEdge } from "./mindmap-records";
import type { MindmapEdge, MindmapNode } from "./types";
import { defaultNodeData } from "./types";

type Input = {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  selectedNode: MindmapNode | null;
  selectedEdgeId: string | null;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  setNodes: Dispatch<SetStateAction<MindmapNode[]>>;
  setEdges: Dispatch<SetStateAction<MindmapEdge[]>>;
  setSelectedNode: Dispatch<SetStateAction<MindmapNode | null>>;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedEdgeIds: Dispatch<SetStateAction<Set<string>>>;
  setEdgeMenu: Dispatch<SetStateAction<EdgeMenuState | null>>;
  history: ReturnType<typeof useMindmapHistory>;
  reactFlowInstance: ReturnType<typeof useReactFlow>;
};

export function useMindmapNodeActions({
  nodes,
  edges,
  selectedNode,
  selectedEdgeId,
  selectedNodeIds,
  selectedEdgeIds,
  setNodes,
  setEdges,
  setSelectedNode,
  setSelectedEdgeId,
  setSelectedNodeIds,
  setSelectedEdgeIds,
  setEdgeMenu,
  history,
  reactFlowInstance,
}: Input) {
  const pushHistory = useCallback(() => {
    history.pushSnapshot(nodes, edges);
  }, [history, nodes, edges]);

  const addNode = useCallback(() => {
    pushHistory();
    const viewport = reactFlowInstance.getViewport();
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom;
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom;

    const newNode: MindmapNode = {
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: {
        x: centerX - 120 + Math.random() * 40 - 20,
        y: centerY - 40 + Math.random() * 40 - 20,
      },
      type: "mindmap",
      data: defaultNodeData({
        label: "New Node",
        icon: "",
        borderColor: "",
      }),
    };

    // If there's a selected node, add as child
    if (selectedNode) {
      const parentId = selectedNode.id;
      const newEdge = createConnectionEdge(parentId, newNode.id);
      setNodes((cur) => cur.concat(newNode));
      setEdges((cur) => [...cur, newEdge]);
      // Position relative to parent
      const parent = nodes.find((n) => n.id === parentId);
      if (parent) {
        newNode.position = {
          x: parent.position.x + 300,
          y: parent.position.y + Math.random() * 100 - 50,
        };
        newNode.data.depth = (parent.data.depth || 0) + 1;
        setNodes((cur) =>
          cur.map((n) =>
            n.id === newNode.id ? { ...n, position: newNode.position, data: newNode.data } : n,
          ),
        );
      }
    } else {
      setNodes((cur) => cur.concat(newNode));
    }
  }, [pushHistory, reactFlowInstance, selectedNode, nodes]);

  // Add child to selected node (Tab key)
  const addChildNode = useCallback(() => {
    if (!selectedNode) return;
    pushHistory();
    const horizontalStep = 240;
    const childOffsetCandidates = Array.from({ length: 16 }, (_, i) => {
      if (i === 0) return 0;
      const rank = Math.ceil(i / 2);
      return (i % 2 === 1 ? 1 : -1) * rank * horizontalStep;
    });
    const siblingNodes = edges
      .filter((edge) => edge.source === selectedNode.id)
      .map((edge) => nodes.find((node) => node.id === edge.target))
      .filter(Boolean) as MindmapNode[];
    const occupiedOffsets = siblingNodes.map((node) => node.position.x - selectedNode.position.x);
    const targetOffset =
      childOffsetCandidates.find((offset) =>
        occupiedOffsets.every((taken) => Math.abs(taken - offset) > horizontalStep * 0.66),
      ) ?? (siblingNodes.length + 1) * horizontalStep;
    const childNode: MindmapNode = {
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: {
        x: selectedNode.position.x + targetOffset,
        y: selectedNode.position.y + 190,
      },
      type: "mindmap",
      data: defaultNodeData({
        label: "New Node",
        depth: (selectedNode.data.depth || 0) + 1,
        borderColor: "",
      }),
    };

    const newEdge = createConnectionEdge(
      selectedNode.id,
      childNode.id,
      "bottom-source",
      "top-target",
    );

    setNodes((cur) => [...cur, childNode]);
    setEdges((cur) => [...cur, newEdge]);
    setSelectedNode(childNode);
  }, [selectedNode, pushHistory, edges, nodes]);

  // Add sibling (Enter key)
  const addSiblingNode = useCallback(() => {
    if (!selectedNode) return;
    pushHistory();

    // Find parent
    const parentEdge = edges.find((e) => e.target === selectedNode.id);
    const parentNode = parentEdge ? nodes.find((n) => n.id === parentEdge.source) : null;

    const siblingNode: MindmapNode = {
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: {
        x: selectedNode.position.x,
        y: selectedNode.position.y + 120,
      },
      type: "mindmap",
      data: defaultNodeData({
        label: "New Node",
        depth: selectedNode.data.depth,
        borderColor: "",
      }),
    };

    const newNodes = [...nodes, siblingNode];
    const newEdges = [...edges];

    if (parentNode) {
      newEdges.push(createConnectionEdge(parentNode.id, siblingNode.id));
    }

    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNode(siblingNode);
  }, [selectedNode, edges, nodes, pushHistory]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    pushHistory();
    const nodeId = selectedNode.id;
    setNodes((cur) => cur.filter((n) => n.id !== nodeId));
    setEdges((cur) => cur.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
    setSelectedNodeIds(new Set());
  }, [selectedNode, pushHistory]);

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    pushHistory();
    setEdges((cur) => cur.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
    setSelectedEdgeIds(new Set());
    setEdgeMenu(null);
  }, [selectedEdgeId, pushHistory]);

  const deleteSelection = useCallback(() => {
    const nodeIds = selectedNodeIds;
    const edgeIds = selectedEdgeIds;
    if (nodeIds.size === 0 && edgeIds.size === 0) return;
    pushHistory();
    setNodes((cur) => cur.filter((node) => !nodeIds.has(node.id)));
    setEdges((cur) =>
      cur.filter(
        (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
      ),
    );
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setEdgeMenu(null);
  }, [selectedNodeIds, selectedEdgeIds, pushHistory]);

  const duplicateSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    pushHistory();
    const duplicated: MindmapNode = {
      ...selectedNode,
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: {
        x: selectedNode.position.x + 44,
        y: selectedNode.position.y + 44,
      },
      selected: false,
      dragging: false,
      data: {
        ...selectedNode.data,
        tags: Array.isArray(selectedNode.data.tags) ? [...selectedNode.data.tags] : [],
        createdAt: new Date().toISOString(),
      },
    };
    setNodes((cur) => [...cur, duplicated]);
    setSelectedNode(duplicated);
    setSelectedEdgeId(null);
    setEdgeMenu(null);
  }, [selectedNode, pushHistory]);

  const duplicateSelection = useCallback(() => {
    const nodeIds = selectedNodeIds;
    const edgeIds = selectedEdgeIds;
    if (nodeIds.size === 0 && edgeIds.size === 0) {
      if (selectedNode) duplicateSelectedNode();
      return;
    }
    pushHistory();
    const offsetX = 48;
    const offsetY = 48;
    const idMap = new Map<string, string>();
    const nodesToDuplicate = nodes.filter((node) => nodeIds.has(node.id));
    const duplicatedNodes: MindmapNode[] = nodesToDuplicate.map((node, index) => {
      const newId = `node-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 5)}`;
      idMap.set(node.id, newId);
      return {
        ...node,
        id: newId,
        position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
        selected: false,
        dragging: false,
        data: {
          ...node.data,
          tags: Array.isArray(node.data.tags) ? [...node.data.tags] : [],
          createdAt: new Date().toISOString(),
        },
      };
    });
    const edgesToDuplicate = edges.filter(
      (edge) => edgeIds.has(edge.id) || (nodeIds.has(edge.source) && nodeIds.has(edge.target)),
    );
    const duplicatedEdges: MindmapEdge[] = [];
    for (let i = 0; i < edgesToDuplicate.length; i += 1) {
      const edge = edgesToDuplicate[i]!;
      const newSource = idMap.get(edge.source) ?? edge.source;
      const newTarget = idMap.get(edge.target) ?? edge.target;
      const exists = edges.some(
        (existing) =>
          existing.source === newSource &&
          existing.target === newTarget &&
          (existing.sourceHandle ?? null) === (edge.sourceHandle ?? null) &&
          (existing.targetHandle ?? null) === (edge.targetHandle ?? null),
      );
      if (exists) continue;
      duplicatedEdges.push({
        ...edge,
        id: `edge-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
        source: newSource,
        target: newTarget,
      });
    }
    if (duplicatedNodes.length === 0 && duplicatedEdges.length === 0) return;
    setNodes((cur) => [...cur, ...duplicatedNodes]);
    setEdges((cur) => [...cur, ...duplicatedEdges]);
    const nextNodeIds = new Set(duplicatedNodes.map((node) => node.id));
    const nextEdgeIds = new Set(duplicatedEdges.map((edge) => edge.id));
    setSelectedNodeIds(nextNodeIds);
    setSelectedEdgeIds(nextEdgeIds);
    setSelectedNode(duplicatedNodes[0] ?? null);
    setSelectedEdgeId(duplicatedEdges[0]?.id ?? null);
    setEdgeMenu(null);
  }, [
    selectedNodeIds,
    selectedEdgeIds,
    selectedNode,
    duplicateSelectedNode,
    pushHistory,
    nodes,
    edges,
  ]);

  const deleteNodeById = useCallback(
    (nodeId: string) => {
      pushHistory();
      setNodes((cur) => cur.filter((node) => node.id !== nodeId));
      setEdges((cur) => cur.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      setSelectedNode((cur) => (cur?.id === nodeId ? null : cur));
    },
    [pushHistory],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onNodeUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<{ nodeId: string; key: keyof MindmapNode["data"]; value: any }>
      ).detail;
      if (!detail?.nodeId) return;
      setNodes((current) =>
        current.map((node) =>
          node.id === detail.nodeId
            ? { ...node, data: { ...node.data, [detail.key]: detail.value } }
            : node,
        ),
      );
      setSelectedNode((current) =>
        current?.id === detail.nodeId
          ? { ...current, data: { ...current.data, [detail.key]: detail.value } }
          : current,
      );
    };
    const onNodeDelete = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string }>).detail;
      if (!detail?.nodeId) return;
      deleteNodeById(detail.nodeId);
    };
    window.addEventListener("moduo:mindmap:node-update", onNodeUpdate);
    window.addEventListener("moduo:mindmap:node-delete", onNodeDelete);
    return () => {
      window.removeEventListener("moduo:mindmap:node-update", onNodeUpdate);
      window.removeEventListener("moduo:mindmap:node-delete", onNodeDelete);
    };
  }, [deleteNodeById]);

  return {
    pushHistory,
    addNode,
    addChildNode,
    addSiblingNode,
    deleteSelectedNode,
    deleteSelectedEdge,
    deleteSelection,
    duplicateSelectedNode,
    duplicateSelection,
  };
}
