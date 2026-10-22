// The open mindmap's document: which map is selected (and how many exist),
// loading it into nodes/edges, and the debounced auto-save. The page owns the
// nodes, edges and selection; this hook fills and reads them.

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ModuoRuntime } from "../../../lib/runtime";
import type { EdgeMenuState } from "./edge-style";
import type { useMindmapHistory } from "./hooks/use-mindmap-history";
import { MINDMAP_SELECT_MAP_EVENT, type MindmapSelectMapDetail } from "./layout-events";
import { normalizeLoadedEdges, normalizeLoadedNodes } from "./mindmap-records";
import {
  listMindmaps,
  loadMindmapDocument,
  readStoredActiveMindmap,
  saveMindmapDocument,
} from "./mindmap-storage";
import type { MindmapEdge, MindmapNode } from "./types";

type Input = {
  runtime: ModuoRuntime;
  workspaceId: string;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  setNodes: Dispatch<SetStateAction<MindmapNode[]>>;
  setEdges: Dispatch<SetStateAction<MindmapEdge[]>>;
  setSelectedNode: Dispatch<SetStateAction<MindmapNode | null>>;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
  setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedEdgeIds: Dispatch<SetStateAction<Set<string>>>;
  setEdgeMenu: Dispatch<SetStateAction<EdgeMenuState | null>>;
  history: ReturnType<typeof useMindmapHistory>;
};

export function useMindmapDocument({
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
}: Input) {
  const [selectedMindmapId, setSelectedMindmapId] = useState<string | null>(null);
  const [mindmapCount, setMindmapCount] = useState(0);
  const [isLoadingMindmap, setIsLoadingMindmap] = useState(false);
  const isHydratingRef = useRef(false);
  const lastSavedSignatureRef = useRef("");

  /* ─── Mindmap list & selection ─── */

  const refreshMindmapCount = useCallback(async () => {
    const maps = await listMindmaps(runtime, workspaceId);
    setMindmapCount(maps.length);
    setSelectedMindmapId((current) => {
      if (current && maps.some((m) => m.id === current)) return current;
      const fallback = readStoredActiveMindmap(workspaceId);
      if (fallback && maps.some((m) => m.id === fallback)) return fallback;
      return maps[0]?.id ?? null;
    });
  }, [runtime, workspaceId]);

  useEffect(() => {
    void refreshMindmapCount();
  }, [refreshMindmapCount]);

  useEffect(() => {
    setSelectedMindmapId(readStoredActiveMindmap(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSelect = (e: Event) => {
      const detail = (e as CustomEvent<MindmapSelectMapDetail>).detail;
      setSelectedMindmapId(detail?.mindmapId ?? null);
      void refreshMindmapCount();
    };
    window.addEventListener(MINDMAP_SELECT_MAP_EVENT, onSelect);
    return () => window.removeEventListener(MINDMAP_SELECT_MAP_EVENT, onSelect);
  }, [refreshMindmapCount]);

  /* ─── Load mindmap data ─── */

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!selectedMindmapId) {
        isHydratingRef.current = true;
        setNodes([]);
        setEdges([]);
        setSelectedNode(null);
        setSelectedEdgeId(null);
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set());
        setEdgeMenu(null);
        lastSavedSignatureRef.current = "";
        isHydratingRef.current = false;
        setIsLoadingMindmap(false);
        return;
      }

      setIsLoadingMindmap(true);
      isHydratingRef.current = true;
      try {
        const doc = await loadMindmapDocument(runtime, workspaceId, selectedMindmapId);
        if (!active) return;

        // Migrate old nodes to new format if needed
        const rawNodes = Array.isArray(doc?.nodes) ? doc.nodes : [];
        const nextNodes = normalizeLoadedNodes(rawNodes);
        const rawEdges = Array.isArray(doc?.edges) ? doc.edges : [];
        const nextEdges = normalizeLoadedEdges(rawEdges);
        setNodes(nextNodes);
        setEdges(nextEdges);
        setSelectedNode(null);
        setSelectedEdgeId(null);
        setSelectedNodeIds(new Set());
        setSelectedEdgeIds(new Set());
        setEdgeMenu(null);
        lastSavedSignatureRef.current = JSON.stringify({ nodes: nextNodes, edges: nextEdges });
        history.clear();
      } catch (error) {
        if (!active) return;
        console.error("Failed to load mindmap", error);
        setNodes([]);
        setEdges([]);
        setSelectedNode(null);
        setSelectedEdgeId(null);
        setEdgeMenu(null);
      } finally {
        if (active) {
          isHydratingRef.current = false;
          setIsLoadingMindmap(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new document is the cue
  }, [runtime, workspaceId, selectedMindmapId]);

  /* ─── Auto-save ─── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedMindmapId || isHydratingRef.current) return;
    const signature = JSON.stringify({ nodes, edges });
    if (signature === lastSavedSignatureRef.current) return;
    const timer = window.setTimeout(() => {
      void saveMindmapDocument(runtime, workspaceId, selectedMindmapId, {
        nodes,
        edges,
        updatedAt: new Date().toISOString(),
      })
        .then(() => {
          lastSavedSignatureRef.current = signature;
        })
        .catch((err) => console.error("Failed to auto-save mindmap", err));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [runtime, workspaceId, selectedMindmapId, nodes, edges]);

  return { selectedMindmapId, mindmapCount, isLoadingMindmap, isHydratingRef };
}
