import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Layers,
  Lock,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveNodeIcon } from "../node-icons";
import type { MindmapEdge, MindmapNode } from "../types";

type Props = {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onImportMermaid: (source: string) => { ok: true } | { ok: false; error: string };
};

type TreeItem = {
  node: MindmapNode;
  children: TreeItem[];
  depth: number;
};

function buildTree(nodes: MindmapNode[], edges: MindmapEdge[]): TreeItem[] {
  const childrenMap = new Map<string, string[]>();
  const childSet = new Set<string>();
  const visited = new Set<string>();

  for (const edge of edges) {
    if (!childrenMap.has(edge.source)) childrenMap.set(edge.source, []);
    childrenMap.get(edge.source)!.push(edge.target);
    childSet.add(edge.target);
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function build(id: string, depth: number, path: Set<string>): TreeItem | null {
    if (path.has(id)) return null;
    if (visited.has(id)) return null;
    const node = nodeMap.get(id);
    if (!node) return null;
    visited.add(id);
    const childIds = childrenMap.get(id) || [];
    const nextPath = new Set(path);
    nextPath.add(id);
    return {
      node,
      children: childIds
        .map((cid) => build(cid, depth + 1, nextPath))
        .filter(Boolean) as TreeItem[],
      depth,
    };
  }

  const roots = nodes.filter((n) => !childSet.has(n.id));
  if (roots.length === 0 && nodes.length > 0) {
    const item = build(nodes[0]!.id, 0, new Set());
    return item ? [item] : [];
  }
  return roots.map((r) => build(r.id, 0, new Set())).filter(Boolean) as TreeItem[];
}

function TreeNode({
  item,
  selectedId,
  onSelect,
  expanded,
  onToggleExpand,
}: {
  item: TreeItem;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
}) {
  const isSelected = item.node.id === selectedId;
  const hasChildren = item.children.length > 0;
  const isOpen = hasChildren ? expanded.has(item.node.id) : false;
  const ItemIcon = resolveNodeIcon(item.node.data.icon);

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isOpen : undefined}
    >
      <div
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 transition-all text-left ${
          isSelected
            ? "bg-[#1a1a1a] text-[#f1f1f1]"
            : "text-[#a3a3a3] hover:bg-[#1c1c1c] hover:text-[#e2e2e2]"
        }`}
        style={{ paddingLeft: `${item.depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleExpand(item.node.id)}
            className="grid h-4 w-4 shrink-0 place-items-center text-[#7b7b7b] hover:text-[#d0d0d0]"
            aria-label={isOpen ? "Collapse children" : "Expand children"}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <button
          onClick={() => onSelect(item.node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-[#3a3a3a]"
        >
          <span className="grid h-4 w-4 shrink-0 place-items-center text-[#6b6b6b]">
            <ItemIcon size={12} />
          </span>
          <span className="text-[11px] font-medium truncate flex-1">{item.node.data.label}</span>
          {hasChildren && (
            <span className="text-[9px] text-[#6b6b6b] shrink-0">{item.children.length}</span>
          )}
        </button>
      </div>

      {hasChildren && isOpen && (
        <div role="group" className="border-l border-[#1f1f1f] ml-[19px]">
          {item.children.map((child) => (
            <TreeNode
              key={child.node.id}
              item={child}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MindmapRelations({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onImportMermaid,
}: Props) {
  const [viewMode, setViewMode] = useState<"tree" | "mermaid">("tree");
  const [mermaidLocked, setMermaidLocked] = useState(true);
  const [mermaidDraft, setMermaidDraft] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const tree = buildTree(nodes, edges);
  const expandedIds = useMemo(() => {
    const ids = new Set(nodes.map((node) => node.id));
    for (const id of collapsedIds) ids.delete(id);
    return ids;
  }, [nodes, collapsedIds]);
  const mermaidNotation = useMemo(() => {
    const lines = ["graph TD"];
    for (const node of nodes) {
      const title = (node.data.label || "Untitled").replace(/"/g, '\\"');
      const description = (node.data.description || "")
        .replace(/\n/g, "<br/>")
        .replace(/"/g, '\\"');
      const safeLabel = description ? `${title}<br/>${description}` : title;
      lines.push(`  ${node.id}["${safeLabel}"]`);
      const fill = node.data.bgColor || "#141414";
      const stroke = node.data.borderColor || "transparent";
      const text = node.data.textColor || "#f3f4f6";
      const strokeWidth = node.data.borderColor ? "1.5px" : "0px";
      lines.push(
        `  style ${node.id} fill:${fill},stroke:${stroke},stroke-width:${strokeWidth},color:${text}`,
      );
    }
    for (let i = 0; i < edges.length; i += 1) {
      const edge = edges[i]!;
      const rawLabel =
        (typeof edge.data?.label === "string" && edge.data.label) ||
        (typeof edge.label === "string" ? edge.label : "");
      const safeEdgeLabel = rawLabel.replace(/\|/g, "\\|").replace(/"/g, '\\"');
      lines.push(
        safeEdgeLabel.trim()
          ? `  ${edge.source} -->|${safeEdgeLabel}| ${edge.target}`
          : `  ${edge.source} --> ${edge.target}`,
      );
      const edgeColor =
        (typeof edge.data?.color === "string" && edge.data.color) ||
        (typeof edge.style?.stroke === "string" ? edge.style.stroke : "#ffffff");
      const edgeWidthRaw = Number(edge.data?.thickness ?? edge.style?.strokeWidth ?? 2);
      const edgeWidth = Number.isFinite(edgeWidthRaw) && edgeWidthRaw > 0 ? edgeWidthRaw : 2;
      const dasharray =
        edge.data?.pattern === "dashed"
          ? "7 6"
          : edge.data?.pattern === "dotted"
            ? "1 10"
            : typeof edge.style?.strokeDasharray === "string"
              ? edge.style.strokeDasharray
              : "";
      lines.push(
        `  linkStyle ${i} stroke:${edgeColor},stroke-width:${edgeWidth}px${dasharray ? `,stroke-dasharray:${dasharray}` : ""}`,
      );
    }
    return lines.join("\n");
  }, [nodes, edges]);

  useEffect(() => {
    if (mermaidLocked) {
      setMermaidDraft(mermaidNotation);
      setImportError(null);
    }
  }, [mermaidNotation, mermaidLocked]);

  // Connection info for selected node
  const selectedConnections = selectedNodeId
    ? {
        parents: edges
          .filter((e) => e.target === selectedNodeId)
          .map((e) => nodes.find((n) => n.id === e.source))
          .filter(Boolean) as MindmapNode[],
        children: edges
          .filter((e) => e.source === selectedNodeId)
          .map((e) => nodes.find((n) => n.id === e.target))
          .filter(Boolean) as MindmapNode[],
        siblings: (() => {
          const parentIds = edges.filter((e) => e.target === selectedNodeId).map((e) => e.source);
          const sibIds = new Set(
            edges
              .filter((e) => parentIds.includes(e.source) && e.target !== selectedNodeId)
              .map((e) => e.target),
          );
          return nodes.filter((n) => sibIds.has(n.id));
        })(),
      }
    : null;

  const handleCopyMermaid = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(mermaidNotation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 900);
    } catch {
      setCopied(false);
    }
  };
  const handleToggleExpand = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const handleApplyMermaid = () => {
    const result = onImportMermaid(mermaidDraft);
    if (!result.ok) {
      setImportError(result.error);
      setImportSuccess(false);
      return;
    }
    setImportError(null);
    setImportSuccess(true);
    window.setTimeout(() => setImportSuccess(false), 900);
  };

  useEffect(() => {
    if (!contentScrollRef.current) return;
    contentScrollRef.current.scrollTop = 0;
    contentScrollRef.current.scrollLeft = 0;
  }, [viewMode]);

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      role="region"
      aria-label="Graph relations"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-center border-b border-[#1f1f1f] pb-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-[#2a2a2a] bg-[#171717] p-1">
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-colors ${
              viewMode === "tree"
                ? "bg-[#2a2a2a] text-[#f3f3f3]"
                : "text-[#8e8e8e] hover:text-[#d7d7d7]"
            }`}
            aria-pressed={viewMode === "tree"}
          >
            Structure
          </button>
          <button
            type="button"
            onClick={() => setViewMode("mermaid")}
            className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-colors ${
              viewMode === "mermaid"
                ? "bg-[#2a2a2a] text-[#f3f3f3]"
                : "text-[#8e8e8e] hover:text-[#d7d7d7]"
            }`}
            aria-pressed={viewMode === "mermaid"}
          >
            Mermaid
          </button>
        </div>
      </div>

      {/* Tree outline */}
      <div
        ref={contentScrollRef}
        className="flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto pr-1"
        role="tree"
        aria-label="Mindmap tree structure"
      >
        {viewMode === "mermaid" ? (
          <div className="w-full min-w-0 rounded-lg bg-[#141414] px-2 py-2">
            <div className="mb-2 flex items-center gap-1">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-[#7d7d7d]">
                Mermaid
              </div>
              <button
                type="button"
                onClick={() => {
                  setMermaidLocked((current) => !current);
                  setImportError(null);
                }}
                className="grid h-5 w-5 place-items-center text-[#8a8a8a] hover:text-[#d0d0d0]"
                aria-label={mermaidLocked ? "Unlock Mermaid editor" : "Lock Mermaid editor"}
                title={mermaidLocked ? "Unlock Mermaid editor" : "Lock Mermaid editor"}
              >
                {mermaidLocked ? <Lock size={11} /> : <Unlock size={11} />}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyMermaid()}
                className={`grid h-5 w-5 place-items-center transition-all duration-200 ${
                  copied ? "scale-110 text-[#f1f1f1]" : "text-[#8a8a8a] hover:text-[#d0d0d0]"
                }`}
                aria-label="Copy Mermaid code"
                title="Copy Mermaid code"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
              </button>
              {!mermaidLocked ? (
                <button
                  type="button"
                  onClick={handleApplyMermaid}
                  className={`ml-auto rounded-md px-2 py-1 text-[9px] font-semibold uppercase tracking-wider ${
                    importSuccess
                      ? "bg-[#1f3f2a] text-[#8af0a9]"
                      : "bg-[#1f1f1f] text-[#d0d0d0] hover:bg-[#292929]"
                  }`}
                  aria-label="Apply Mermaid to mindmap"
                  title="Apply Mermaid to mindmap"
                >
                  {importSuccess ? "Applied" : "Apply"}
                </button>
              ) : null}
            </div>
            {mermaidLocked ? (
              <pre className="w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-[1.75] text-[#c8c8c8]">
                {mermaidNotation}
              </pre>
            ) : (
              <textarea
                value={mermaidDraft}
                onChange={(event) => setMermaidDraft(event.target.value)}
                className="h-[380px] w-full min-w-0 resize-y rounded-md border border-[#2a2a2a] bg-[#101010] p-2 font-mono text-[10px] leading-[1.55] text-[#d6d6d6] outline-none focus:border-[#4a4a4a]"
                aria-label="Editable Mermaid source"
                spellCheck={false}
              />
            )}
            {importError ? (
              <div className="mt-2 rounded-md border border-[#522] bg-[#2a1616] px-2 py-1 text-[10px] text-[#ffb5b5]">
                {importError}
              </div>
            ) : null}
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Layers size={20} className="text-[#7a7a7a]" />
            <p className="text-[11px] text-[#7a7a7a]">No nodes yet</p>
          </div>
        ) : (
          <div className="min-w-max">
            {tree.map((item) => (
              <TreeNode
                key={item.node.id}
                item={item}
                selectedId={selectedNodeId}
                onSelect={onSelectNode}
                expanded={expandedIds}
                onToggleExpand={handleToggleExpand}
              />
            ))}
          </div>
        )}
      </div>

      {/* Connections panel for selected node */}
      {selectedConnections && (
        <div className="mt-3 border-t border-[#1f1f1f] pt-3">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#8e8e8e]">
            Connections
          </h3>

          {selectedConnections.parents.length > 0 && (
            <div className="mb-2">
              <div className="text-[9px] text-[#8e8e8e] mb-1 font-semibold">↑ Parents</div>
              {selectedConnections.parents.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onSelectNode(n.id)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] text-[#a3a3a3] hover:bg-[#1c1c1c] hover:text-[#e2e2e2] transition-colors focus-visible:outline-2 focus-visible:outline-[#3a3a3a]"
                >
                  <ArrowRight size={10} className="text-[#6b6b6b] rotate-[-90deg]" />
                  {n.data.label}
                </button>
              ))}
            </div>
          )}

          {selectedConnections.children.length > 0 && (
            <div className="mb-2">
              <div className="text-[9px] text-[#8e8e8e] mb-1 font-semibold">↓ Children</div>
              {selectedConnections.children.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onSelectNode(n.id)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] text-[#a3a3a3] hover:bg-[#1c1c1c] hover:text-[#e2e2e2] transition-colors focus-visible:outline-2 focus-visible:outline-[#3a3a3a]"
                >
                  <ArrowRight size={10} className="text-[#6b6b6b] rotate-90" />
                  {n.data.label}
                </button>
              ))}
            </div>
          )}

          {selectedConnections.siblings.length > 0 && (
            <div>
              <div className="text-[9px] text-[#8e8e8e] mb-1 font-semibold">↔ Siblings</div>
              {selectedConnections.siblings.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onSelectNode(n.id)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] text-[#a3a3a3] hover:bg-[#1c1c1c] hover:text-[#e2e2e2] transition-colors focus-visible:outline-2 focus-visible:outline-[#3a3a3a]"
                >
                  <ArrowRight size={10} className="text-[#6b6b6b]" />
                  {n.data.label}
                </button>
              ))}
            </div>
          )}

          {selectedConnections.parents.length === 0 &&
            selectedConnections.children.length === 0 &&
            selectedConnections.siblings.length === 0 && (
              <p className="text-[10px] text-[#7a7a7a] text-center py-2">No connections</p>
            )}
        </div>
      )}
    </div>
  );
}
