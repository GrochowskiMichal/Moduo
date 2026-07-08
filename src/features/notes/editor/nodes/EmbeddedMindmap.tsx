import { useEffect, useState, useMemo } from "react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MindmapCustomNode } from "../../../mindmap/ui/custom-node";
import type { MindmapNode, MindmapEdge } from "../../../mindmap/ui/types";

// Since MindmapDocument wasn't exported from types, we'll define a local type
type MindmapDocument = {
    nodes: MindmapNode[];
    edges: MindmapEdge[];
    updatedAt: string;
};

const DEFAULT_EDGE_COLOR = "#333333";

const nodeTypes = {
    mindmap: MindmapCustomNode,
};

export function EmbeddedMindmap({ mindmapId }: { mindmapId: string }) {
    const [doc, setDoc] = useState<MindmapDocument | null>(null);
    const [name, setName] = useState<string>("Untitled Mindmap");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        const loadMindmap = async () => {
            try {
                const { getRuntime } = await import("../../../../lib/runtime");
                const runtime = getRuntime();
                if (!runtime) return;

                const wss = await runtime.workspace.list();
                for (const w of wss) {
                    try {
                        const { listMindmaps, loadMindmapDocument } = await import("../../../mindmap/ui/mindmap-storage");
                        const mindmaps = await listMindmaps(runtime, w.id);
                        const foundMeta = mindmaps.find((m: any) => m.id === mindmapId);
                        if (foundMeta) {
                            const d = await loadMindmapDocument(runtime, w.id, mindmapId);
                            if (active && d) {
                                setDoc(d);
                                setName(foundMeta.name);
                                break;
                            }
                        }
                    } catch (e) { }
                }
            } catch (err) {
                console.error("Failed to load embedded mindmap", err);
            } finally {
                if (active) setLoading(false);
            }
        };
        void loadMindmap();
        return () => {
            active = false;
        };
    }, [mindmapId]);

    const nodes = useMemo(() => {
        if (!doc) return [];
        // Readonly mapping
        return doc.nodes.map((n: MindmapNode) => ({
            ...n,
            draggable: false,
            selectable: false,
        }));
    }, [doc]);

    if (loading) {
        return (
            <div className="w-full max-w-[800px] h-[300px] bg-[#1a1a1a]/50 border border-[#2a2a2a] rounded-xl flex items-center justify-center animate-pulse">
                <span className="text-[12px] text-[#555]">Loading embedded mindmap...</span>
            </div>
        );
    }

    if (!doc) {
        return (
            <div className="w-full max-w-[800px] bg-[#1a1a1a]/50 border border-[#2a2a2a] rounded-xl p-4 text-[#888] text-[13px]">
                Embedded Mindmap <span className="font-mono text-[10px] text-[#555]">{mindmapId}</span> could not be found or was deleted.
            </div>
        );
    }

    return (
        <div className="w-full max-w-[800px] h-[400px] flex flex-col rounded-2xl border border-[#2a2a2a] bg-[#111] overflow-hidden shadow-lg relative cursor-default select-none pointer-events-auto">
            <div className="absolute top-0 left-0 w-full px-4 py-2 bg-gradient-to-b from-[#111] to-transparent z-10 flex items-center gap-2 pointer-events-none">
                <span className="text-[14px] font-semibold text-[#f1f1f1] drop-shadow-md">{name}</span>
                <span className="text-[10px] uppercase font-bold text-[#888] tracking-widest bg-[#222]/80 px-1.5 py-0.5 rounded backdrop-blur-sm border border-[#333]">Mindmap</span>
            </div>
            <div className="flex-1 w-full h-full relative">
                <ReactFlowProvider>
                    <ReactFlow
                        nodes={nodes}
                        edges={doc.edges}
                        nodeTypes={nodeTypes}
                        panOnDrag={true}
                        zoomOnScroll={true}
                        panOnScroll={true}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        elementsSelectable={false}
                        minZoom={0.1}
                        maxZoom={2}
                        fitView
                        colorMode="dark"
                        proOptions={{ hideAttribution: true }}
                        defaultEdgeOptions={{
                            animated: true,
                            style: { strokeWidth: 2, stroke: DEFAULT_EDGE_COLOR },
                        }}
                        style={{ background: "#111" }}
                        preventScrolling={false}
                    />
                </ReactFlowProvider>
            </div>
        </div>
    );
}
