import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import { Eyebrow } from "@/components/ui/eyebrow";
import { MindmapCustomNode } from "../../../mindmap/ui/custom-node";
import type { MindmapEdge, MindmapNode } from "../../../mindmap/ui/types";

// Since MindmapDocument wasn't exported from types, we'll define a local type
type MindmapDocument = {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  updatedAt: string;
};

// react-flow renders edges as SVG whose `stroke` resolves CSS vars from the DOM.
const DEFAULT_EDGE_COLOR = "var(--border)";

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
            const { listMindmaps, loadMindmapDocument } = await import(
              "../../../mindmap/ui/mindmap-storage"
            );
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
          } catch (e) {}
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
      <div className="w-full max-w-[800px] h-[300px] bg-muted/50 border border-border rounded-xl flex items-center justify-center animate-pulse">
        <span className="text-xs text-muted-foreground">Loading embedded mindmap...</span>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="w-full max-w-[800px] bg-muted/50 border border-border rounded-xl p-4 text-muted-foreground text-sm">
        Embedded Mindmap{" "}
        <span className="font-mono text-2xs text-muted-foreground">{mindmapId}</span> could not be
        found or was deleted.
      </div>
    );
  }

  return (
    <div className="w-full max-w-[800px] h-[400px] flex flex-col rounded-2xl border border-border bg-card overflow-hidden shadow-lg relative cursor-default select-none pointer-events-auto">
      <div className="absolute top-0 left-0 w-full px-4 py-2 bg-gradient-to-b from-card to-transparent z-10 flex items-center gap-2 pointer-events-none">
        <span className="text-base font-semibold text-foreground drop-shadow-md">{name}</span>
        <Eyebrow tone="strong" className="rounded border border-border bg-accent px-1.5 py-0.5">
          Mindmap
        </Eyebrow>
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
            style={{ background: "var(--card)" }}
            preventScrolling={false}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
