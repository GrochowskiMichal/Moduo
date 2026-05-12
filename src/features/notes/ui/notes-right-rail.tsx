import { useMemo } from "react";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network } from "lucide-react";
import type { NoteMeta } from "../types";
import { TagInput } from "../../../components/ui/tag-input";
import { Badge } from "../../../components/ui/badge";

const SECTION_TITLE =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground";

type Props = {
  selectedNote: NoteMeta | null;
  allNotes: NoteMeta[];
  readOnly: boolean;
  onSelectNote: (id: string) => void;
  onUpdateTags: (noteId: string, tags: string[]) => Promise<void>;
};

type Relation = { note: NoteMeta; shared: number };

function useCloseRelations(selectedNote: NoteMeta | null, allNotes: NoteMeta[]): Relation[] {
  return useMemo(() => {
    if (!selectedNote) return [];
    const selectedTags = new Set((selectedNote.tags ?? []).map((tag) => tag.toLowerCase()));
    if (selectedTags.size === 0) return [];
    return allNotes
      .filter(
        (note) =>
          note.id !== selectedNote.id &&
          note.kind !== "category" &&
          !note.deletedAt &&
          !note.isArchived,
      )
      .map((note) => ({
        note,
        shared: (note.tags ?? []).reduce(
          (count, tag) => (selectedTags.has(tag.toLowerCase()) ? count + 1 : count),
          0,
        ),
      }))
      .filter((entry) => entry.shared > 0)
      .sort((a, b) => b.shared - a.shared || a.note.title.localeCompare(b.note.title))
      .slice(0, 8);
  }, [selectedNote, allNotes]);
}

const GRAPH_NODE_BASE_STYLE = {
  background: "var(--card)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  fontSize: "var(--text-xs)",
  fontFamily: "var(--font-body)",
  padding: "0.375rem 0.625rem",
  minWidth: 80,
  textAlign: "center" as const,
  boxShadow: "var(--shadow-sm)",
};

const GRAPH_CENTER_STYLE = {
  ...GRAPH_NODE_BASE_STYLE,
  background: "var(--primary)",
  color: "var(--primary-foreground)",
  borderColor: "var(--primary)",
  fontWeight: 600,
};

function RelationGraph({
  center,
  relations,
  onSelectNote,
}: {
  center: NoteMeta;
  relations: Relation[];
  onSelectNote: (id: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const radius = 88;
    const cx = 0;
    const cy = 0;
    const centerNode: Node = {
      id: center.id,
      type: "default",
      position: { x: cx, y: cy },
      data: { label: truncate(center.title || "Untitled", 16) },
      style: GRAPH_CENTER_STYLE,
      draggable: false,
      selectable: false,
      connectable: false,
    };
    const relationNodes: Node[] = relations.map((entry, index) => {
      const angle = (index / Math.max(relations.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        id: entry.note.id,
        type: "default",
        position: {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        },
        data: { label: truncate(entry.note.title || "Untitled", 14) },
        style: GRAPH_NODE_BASE_STYLE,
        draggable: false,
        connectable: false,
      };
    });
    const relationEdges: Edge[] = relations.map((entry) => ({
      id: `edge:${center.id}:${entry.note.id}`,
      source: center.id,
      target: entry.note.id,
      style: { stroke: "var(--border)", strokeWidth: 1 },
    }));
    return { nodes: [centerNode, ...relationNodes], edges: relationEdges };
  }, [center, relations]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.4}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll={false}
        panOnDrag
        preventScrolling={false}
        onNodeClick={(_event, node) => {
          if (node.id !== center.id) onSelectNote(node.id);
        }}
        style={{ background: "transparent" }}
      >
        <Background gap={16} color="var(--border)" />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function NotesRightRail({
  selectedNote,
  allNotes,
  readOnly,
  onSelectNote,
  onUpdateTags,
}: Props) {
  const editorTarget = selectedNote && selectedNote.kind !== "category" ? selectedNote : null;
  const closeRelations = useCloseRelations(editorTarget, allNotes);

  if (!editorTarget) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <Network className="size-6" aria-hidden="true" />
        <p className="text-sm">Open a note to see its relations.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto">
      <section className="flex flex-col gap-2">
        <h4 className={SECTION_TITLE}>Relation Graph</h4>
        <div className="aspect-square w-full overflow-hidden rounded-md border border-border bg-background">
          {closeRelations.length > 0 ? (
            <RelationGraph
              center={editorTarget}
              relations={closeRelations}
              onSelectNote={onSelectNote}
            />
          ) : (
            <div className="grid h-full place-content-center px-4 text-center text-xs text-muted-foreground">
              Add tags to surface connections.
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className={SECTION_TITLE}>Tags</h4>
        <TagInput
          tags={editorTarget.tags ?? []}
          onChange={(next) => void onUpdateTags(editorTarget.id, next)}
          disabled={readOnly}
          placeholder="Add tag…"
        />
      </section>

      <section className="flex flex-col gap-2">
        <h4 className={SECTION_TITLE}>Close Relations</h4>
        {closeRelations.length > 0 ? (
          <ul className="flex flex-col gap-px">
            {closeRelations.map(({ note, shared }) => (
              <li key={note.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ minHeight: "var(--row-h)" }}
                  onClick={() => onSelectNote(note.id)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {note.title || "Untitled"}
                  </span>
                  <Badge variant="secondary" className="shrink-0">
                    {shared}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">
            No notes share tags with this one yet.
          </p>
        )}
      </section>
    </div>
  );
}
