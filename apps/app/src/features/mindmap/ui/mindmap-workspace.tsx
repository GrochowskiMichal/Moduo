import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useReactFlow,
} from "@xyflow/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import type { ModuoRuntime } from "../../../lib/runtime";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import { MindmapMiniMap } from "./components/mindmap-mini-map";
import { MindmapRelations } from "./components/mindmap-relations";
import { MindmapToolbar } from "./components/mindmap-toolbar";
import { MindmapCustomNode } from "./custom-node";
import {
  DEFAULT_EDGE_COLOR,
  DEFAULT_THEME,
  type EdgeMenuPanel,
  type EdgeMenuState,
  normalizeEdgeData,
} from "./edge-style";
import { EdgeStyleMenu } from "./edge-style-menu";
import { useMindmapHistory } from "./hooks/use-mindmap-history";
import { parseMermaidToMindmap } from "./mermaid-import";
import { MindmapEmptyState, MindmapLoadingState } from "./mindmap-empty-state";
import { createConnectionEdge } from "./mindmap-records";
import type { MindmapEdge, MindmapNode } from "./types";
import { useMindmapDocument } from "./use-mindmap-document";
import { useMindmapEdgeStyle } from "./use-mindmap-edge-style";
import { useMindmapKeyboard } from "./use-mindmap-keyboard";
import { useMindmapNodeActions } from "./use-mindmap-node-actions";
import "@xyflow/react/dist/style.css";

/* ═══════════════════════ Constants ═══════════════════════ */

const nodeTypes: NodeTypes = { mindmap: MindmapCustomNode };

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/* ═══════════════════════ Canvas Component ═══════════════════════ */

function MindmapCanvas({ workspaceId, runtime }: { workspaceId: string; runtime: ModuoRuntime }) {
  // --- Core state ---
  const [nodes, setNodes] = useState<MindmapNode[]>([]);
  const [edges, setEdges] = useState<MindmapEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<MindmapNode | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);
  const [edgeColorDraft, setEdgeColorDraft] = useState("");

  // --- Visual settings ---
  const theme = DEFAULT_THEME;

  // --- Refs ---
  const edgeMenuRef = useRef<HTMLDivElement | null>(null);

  // --- Hooks ---
  const history = useMindmapHistory();
  const reactFlowInstance = useReactFlow();
  const { selectedMindmapId, mindmapCount, isLoadingMindmap, isHydratingRef } = useMindmapDocument({
    runtime,
    workspaceId,
    nodes,
    edges,
    setNodes,
    setEdges,
    setSelectedNode,
    setSelectedEdgeId,
    setSelectedNodeIds,
    setSelectedEdgeIds,
    setEdgeMenu,
    history,
  });

  /* ─── React Flow handlers ─── */

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((cur) => applyNodeChanges(changes, cur) as MindmapNode[]);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((cur) => applyEdgeChanges(changes, cur) as MindmapEdge[]);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const duplicateExists = edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
          (edge.targetHandle ?? null) === (connection.targetHandle ?? null),
      );
      if (duplicateExists) return;
      history.pushSnapshot(nodes, edges);
      setEdges((cur) =>
        cur.concat(
          createConnectionEdge(
            connection.source!,
            connection.target!,
            connection.sourceHandle,
            connection.targetHandle,
          ),
        ),
      );
    },
    [nodes, edges, history],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const isShift = _.shiftKey || _.metaKey || _.ctrlKey;
    const nodeId = node.id;
    setSelectedNode(node as MindmapNode);
    setSelectedEdgeId(null);
    setEdgeMenu(null);
    setSelectedNodeIds((current) => {
      if (!isShift) return new Set([nodeId]);
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
    if (!isShift) setSelectedEdgeIds(new Set());
    const current = readFeaturePanelState("mindmap");
    if (!current.left) {
      dispatchLayoutPanelsSet({
        feature: "mindmap",
        left: true,
        right: current.right,
      });
    }
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdgeId(null);
    setSelectedNodeIds(new Set());
    setSelectedEdgeIds(new Set());
    setEdgeMenu(null);
  }, []);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
      const menuWidth = 220;
      const menuHeight = 180;
      const maxX =
        typeof window === "undefined"
          ? event.clientX
          : Math.max(12, window.innerWidth - menuWidth - 12);
      const maxY =
        typeof window === "undefined"
          ? event.clientY
          : Math.max(12, window.innerHeight - menuHeight - 12);
      setSelectedNode(null);
      setSelectedEdgeId(edge.id);
      setSelectedNodeIds(new Set());
      setSelectedEdgeIds(new Set([edge.id]));
      setEdgeMenu({
        edgeId: edge.id,
        panel: null,
        x: Math.max(12, Math.min(event.clientX + 12, maxX)),
        y: Math.max(12, Math.min(event.clientY + 12, maxY)),
      });
      return;
    }
    const isShift = event.shiftKey || event.metaKey || event.ctrlKey;
    if (!isShift) {
      setSelectedEdgeId(null);
      setEdgeMenu(null);
      return;
    }
    setSelectedNode(null);
    setSelectedEdgeId(edge.id);
    setSelectedNodeIds((current) => (isShift ? current : new Set()));
    setSelectedEdgeIds((current) => {
      if (!isShift) return new Set([edge.id]);
      const next = new Set(current);
      if (next.has(edge.id)) next.delete(edge.id);
      else next.add(edge.id);
      return next;
    });
    setEdgeMenu(null);
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!newConnection.source || !newConnection.target) return;
      const duplicateExists = edges.some(
        (edge) =>
          edge.id !== oldEdge.id &&
          edge.source === newConnection.source &&
          edge.target === newConnection.target &&
          (edge.sourceHandle ?? null) === (newConnection.sourceHandle ?? null) &&
          (edge.targetHandle ?? null) === (newConnection.targetHandle ?? null),
      );
      if (duplicateExists) return;
      history.pushSnapshot(nodes, edges);
      setEdges((current) => reconnectEdge(oldEdge, newConnection, current) as MindmapEdge[]);
    },
    [edges, history, nodes],
  );
  const { updateEdgeLabel, applyEdgeColor, applyEdgeShape, applyEdgePattern, applyEdgeAnimation } =
    useMindmapEdgeStyle({ nodes, edges, setEdges, history });

  const toggleEdgePanel = useCallback((panel: Exclude<EdgeMenuPanel, null>) => {
    setEdgeMenu((current) => {
      if (!current) return null;
      return {
        ...current,
        panel: current.panel === panel ? null : panel,
      };
    });
  }, []);

  useEffect(() => {
    if (!edgeMenu) return;
    if (!edges.some((edge) => edge.id === edgeMenu.edgeId)) {
      setEdgeMenu(null);
    }
  }, [edgeMenu, edges]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (!edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [selectedEdgeId, edges]);

  useEffect(() => {
    if (!edgeMenu || typeof window === "undefined") return;
    const onPointerDown = (event: MouseEvent) => {
      if (edgeMenuRef.current && !edgeMenuRef.current.contains(event.target as HTMLElement)) {
        setEdgeMenu(null);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [edgeMenu]);

  /* ─── Node operations ─── */

  const {
    pushHistory,
    addNode,
    addChildNode,
    addSiblingNode,
    deleteSelectedNode,
    deleteSelectedEdge,
    deleteSelection,
    duplicateSelectedNode,
    duplicateSelection,
  } = useMindmapNodeActions({
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
  });

  /* ─── Undo / Redo ─── */

  const handleUndo = useCallback(() => {
    const snap = history.undo(nodes, edges);
    if (snap) {
      isHydratingRef.current = true;
      setNodes(snap.nodes);
      setEdges(snap.edges);
      setSelectedNode(null);
      setSelectedEdgeId(null);
      setEdgeMenu(null);
      requestAnimationFrame(() => {
        isHydratingRef.current = false;
      });
    }
  }, [history, nodes, edges]);

  const handleRedo = useCallback(() => {
    const snap = history.redo(nodes, edges);
    if (snap) {
      isHydratingRef.current = true;
      setNodes(snap.nodes);
      setEdges(snap.edges);
      setSelectedNode(null);
      setSelectedEdgeId(null);
      setEdgeMenu(null);
      requestAnimationFrame(() => {
        isHydratingRef.current = false;
      });
    }
  }, [history, nodes, edges]);

  /* ─── Keyboard shortcuts ─── */

  const isCommandMode = useMindmapKeyboard({
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
  });

  /* ─── Navigate to node ─── */

  const navigateToNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setSelectedNode(node);
      setSelectedEdgeId(null);
      setEdgeMenu(null);
      reactFlowInstance.setCenter(node.position.x + 120, node.position.y + 40, {
        zoom: 1.2,
        duration: 400,
      });
    },
    [nodes, reactFlowInstance],
  );

  const activeEdge = edgeMenu ? (edges.find((edge) => edge.id === edgeMenu.edgeId) ?? null) : null;
  const activeEdgeData = activeEdge ? normalizeEdgeData(activeEdge, DEFAULT_EDGE_COLOR) : null;
  const renderedNodes = nodes;
  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const isSelected = selectedEdgeIds.has(edge.id);
        const base = edge.className ?? "";
        return {
          ...edge,
          className: `${base}${isSelected ? " mindmap-edge-selected" : ""}`.trim(),
        };
      }) as MindmapEdge[],
    [edges, selectedEdgeIds],
  );
  useEffect(() => {
    const nextNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    setSelectedNodeIds((current) => (setsEqual(current, nextNodeIds) ? current : nextNodeIds));
  }, [nodes]);

  useEffect(() => {
    if (!activeEdgeData) return;
    setEdgeColorDraft(activeEdgeData.color);
  }, [activeEdge?.id, activeEdgeData?.color]);

  const importMermaid = useCallback(
    (source: string): { ok: true } | { ok: false; error: string } => {
      try {
        const next = parseMermaidToMindmap(source);
        pushHistory();
        setNodes(next.nodes);
        setEdges(next.edges);
        setSelectedNode(null);
        setSelectedEdgeId(null);
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set());
        setEdgeMenu(null);
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to parse Mermaid notation.";
        return { ok: false, error: message };
      }
    },
    [pushHistory],
  );

  /* ─── Render ─── */

  let center: ReactNode = null;

  if (mindmapCount === 0) {
    center = (
      <MindmapEmptyState
        icon="🧠"
        title="No mindmaps yet"
        description="Use the selector next to Mindmap in the top nav to create your first map."
      />
    );
  } else if (!selectedMindmapId) {
    center = (
      <MindmapEmptyState
        icon="🎯"
        title="Select a mindmap"
        description="Choose a mindmap from the top nav dropdown."
      />
    );
  } else if (isLoadingMindmap) {
    center = <MindmapLoadingState />;
  } else {
    center = (
      // The canvas fills the centre to its edges: out of the shell's padding,
      // the derived top and the fixed sides and foot (MOD-121).
      <div className="relative -mx-(--panel-inset) -mt-(--panel-title-top) -mb-(--panel-inset) h-[calc(100%_+_var(--panel-title-top)_+_var(--panel-inset))] min-h-0 w-[calc(100%_+_var(--panel-inset)*2)]">
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          nodeTypes={nodeTypes}
          panOnDrag={isCommandMode}
          selectionOnDrag
          nodesDraggable={!isCommandMode}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          edgesReconnectable
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          minZoom={0.08}
          maxZoom={2}
          fitView
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            animated: true,
            style: { strokeWidth: 2, stroke: DEFAULT_EDGE_COLOR },
          }}
          className={`h-full ${isCommandMode ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
          style={{ background: "#111111" }}
          deleteKeyCode={null} // We handle delete ourselves
          aria-label="Mindmap canvas"
        >
          <MindmapMiniMap theme={theme} />
        </ReactFlow>

        {activeEdge && activeEdgeData && edgeMenu ? (
          <EdgeStyleMenu
            menu={edgeMenu}
            edgeData={activeEdgeData}
            colorDraft={edgeColorDraft}
            menuRef={edgeMenuRef}
            onTogglePanel={toggleEdgePanel}
            onUpdateLabel={(label) => updateEdgeLabel(activeEdge.id, label)}
            onSetColorDraft={setEdgeColorDraft}
            onApplyColor={(color, withHistory) => applyEdgeColor(activeEdge.id, color, withHistory)}
            onApplyShape={(style) => applyEdgeShape(activeEdge.id, style)}
            onApplyPattern={(pattern) => applyEdgePattern(activeEdge.id, pattern)}
            onApplyAnimation={(animated) => applyEdgeAnimation(activeEdge.id, animated)}
          />
        ) : null}

        {/* Keyboard help toolbar */}
        <div className="transition-all duration-300 ease-out">
          <MindmapToolbar />
        </div>
      </div>
    );
  }

  return (
    <FeaturePanelsShell
      feature="mindmap"
      left={
        <MindmapRelations
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={navigateToNode}
          onImportMermaid={importMermaid}
        />
      }
      center={center}
    />
  );
}

/* ═══════════════════════ Exported Wrapper ═══════════════════════ */

export function MindmapWorkspace({
  workspaceId,
  runtime,
}: {
  workspaceId: string;
  runtime: ModuoRuntime;
}) {
  return (
    <ReactFlowProvider>
      <MindmapCanvas workspaceId={workspaceId} runtime={runtime} />
    </ReactFlowProvider>
  );
}
