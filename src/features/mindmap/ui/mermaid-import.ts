import type { MindmapEdge, MindmapNode } from "./types";
import { defaultNodeData } from "./types";

const DEFAULT_EDGE_COLOR = "#ffffff";
const DEFAULT_EDGE_THICKNESS = 2;

function edgeDashFromPattern(pattern: "solid" | "dashed" | "dotted"): string | undefined {
  if (pattern === "dashed") return "7 6";
  if (pattern === "dotted") return "1 10";
  return undefined;
}

function edgeClassName(pattern: "solid" | "dashed" | "dotted", animated: boolean): string {
  const base =
    pattern === "solid"
      ? "mindmap-edge-solid-animated"
      : pattern === "dashed"
        ? "mindmap-edge-dashed"
        : "mindmap-edge-dotted";
  return `${base}${animated ? "" : " mindmap-edge-no-anim"}`.trim();
}

export function parseMermaidToMindmap(source: string): {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
} {
  type ParsedStyle = { bg?: string; border?: string; text?: string };
  type ParsedNodeMeta = { label?: string; className?: string; style?: ParsedStyle };

  function parseStyleAttributes(raw: string): ParsedStyle {
    const out: ParsedStyle = {};
    for (const token of raw.split(",")) {
      const [k, v] = token.split(":");
      if (!k || !v) continue;
      const key = k.trim().toLowerCase();
      const value = v.trim();
      if (key === "fill") out.bg = value;
      if (key === "stroke") out.border = value;
      if (key === "color") out.text = value;
    }
    return out;
  }

  function cleanEdgeLabel(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
    return trimmed.replace(/\\n/g, "\n");
  }

  function parseEndpoint(expr: string): { id: string; label?: string; className?: string } | null {
    const trimmed = expr.trim();
    const idMatch = trimmed.match(/^([A-Za-z][\w-]*)/);
    if (!idMatch) return null;
    const id = idMatch[1]!;
    const classMatch = trimmed.match(/:::\s*([A-Za-z][\w-]*)\s*$/);
    const quotedLabelMatch = trimmed.match(/"([\s\S]*?)"/);
    let label = quotedLabelMatch?.[1];
    if (typeof label === "string") {
      label = label.replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
    return { id, label, className: classMatch?.[1] };
  }

  function upsertNode(metaMap: Map<string, ParsedNodeMeta>, id: string, patch: ParsedNodeMeta) {
    const prev = metaMap.get(id) ?? {};
    metaMap.set(id, {
      label: patch.label ?? prev.label,
      className: patch.className ?? prev.className,
      style: { ...(prev.style ?? {}), ...(patch.style ?? {}) },
    });
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("%%"));

  const ids = new Set<string>();
  const nodeMeta = new Map<string, ParsedNodeMeta>();
  const classDefs = new Map<string, ParsedStyle>();
  const parsedEdges: Array<{ source: string; target: string; label: string }> = [];
  const nodeSubgraph = new Map<string, string>();
  let activeSubgraph: string | null = null;

  const registerNode = (id: string, patch?: ParsedNodeMeta) => {
    ids.add(id);
    if (patch) upsertNode(nodeMeta, id, patch);
    if (activeSubgraph) nodeSubgraph.set(id, activeSubgraph);
  };

  for (const line of lines) {
    if (line.startsWith("graph ")) continue;
    if (line.startsWith("flowchart ")) continue;
    if (line.startsWith("direction ")) continue;
    if (line.startsWith("linkStyle ")) continue; // currently ignored
    if (line.startsWith("subgraph ")) {
      const match = line.match(/^subgraph\s+([A-Za-z][\w-]*)/);
      activeSubgraph = match?.[1] ?? "subgraph";
      continue;
    }
    if (line === "end") {
      activeSubgraph = null;
      continue;
    }

    const classDefMatch = line.match(/^classDef\s+([A-Za-z][\w-]*)\s+(.+)$/);
    if (classDefMatch) {
      classDefs.set(classDefMatch[1]!, parseStyleAttributes(classDefMatch[2]!));
      continue;
    }

    const classAssignMatch = line.match(/^class\s+(.+)\s+([A-Za-z][\w-]*)$/);
    if (classAssignMatch) {
      const idList = classAssignMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const className = classAssignMatch[2]!;
      for (const id of idList) {
        registerNode(id, { className });
      }
      continue;
    }

    const styleMatch = line.match(/^style\s+([A-Za-z][\w-]*)\s+(.+)$/);
    if (styleMatch) {
      const id = styleMatch[1]!;
      registerNode(id, { style: parseStyleAttributes(styleMatch[2]!) });
      continue;
    }

    const edgePiped = line.match(/^(.*?)\s*-->\|([^|]*)\|\s*(.+)$/);
    if (edgePiped) {
      const sourceParsed = parseEndpoint(edgePiped[1]!);
      const targetParsed = parseEndpoint(edgePiped[3]!);
      if (!sourceParsed || !targetParsed) continue;
      registerNode(sourceParsed.id, {
        label: sourceParsed.label,
        className: sourceParsed.className,
      });
      registerNode(targetParsed.id, {
        label: targetParsed.label,
        className: targetParsed.className,
      });
      parsedEdges.push({
        source: sourceParsed.id,
        target: targetParsed.id,
        label: cleanEdgeLabel(edgePiped[2]!),
      });
      continue;
    }

    const edgeLabeled = line.match(/^(.*?)\s*--\s*(.*?)\s*-->\s*(.+)$/);
    if (edgeLabeled) {
      const sourceParsed = parseEndpoint(edgeLabeled[1]!);
      const targetParsed = parseEndpoint(edgeLabeled[3]!);
      if (!sourceParsed || !targetParsed) continue;
      registerNode(sourceParsed.id, {
        label: sourceParsed.label,
        className: sourceParsed.className,
      });
      registerNode(targetParsed.id, {
        label: targetParsed.label,
        className: targetParsed.className,
      });
      parsedEdges.push({
        source: sourceParsed.id,
        target: targetParsed.id,
        label: cleanEdgeLabel(edgeLabeled[2]!),
      });
      continue;
    }

    const edgeSimple = line.match(/^(.*?)\s*-->\s*(.+)$/);
    if (edgeSimple) {
      const sourceParsed = parseEndpoint(edgeSimple[1]!);
      const targetParsed = parseEndpoint(edgeSimple[2]!);
      if (!sourceParsed || !targetParsed) continue;
      registerNode(sourceParsed.id, {
        label: sourceParsed.label,
        className: sourceParsed.className,
      });
      registerNode(targetParsed.id, {
        label: targetParsed.label,
        className: targetParsed.className,
      });
      parsedEdges.push({ source: sourceParsed.id, target: targetParsed.id, label: "" });
      continue;
    }

    const standaloneNode = parseEndpoint(line);
    if (standaloneNode) {
      registerNode(standaloneNode.id, {
        label: standaloneNode.label,
        className: standaloneNode.className,
      });
    }
  }

  if (ids.size === 0) {
    throw new Error('No Mermaid nodes found. Expected lines like A["Label"] and A --> B.');
  }

  const nodeIds = Array.from(ids);
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
    reverseAdjacency.set(id, []);
  }
  for (const edge of parsedEdges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!reverseAdjacency.has(edge.target)) reverseAdjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push(edge.target);
    reverseAdjacency.get(edge.target)!.push(edge.source);
  }

  const hasPath = (from: string, to: string): boolean => {
    if (from === to) return true;
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const next = adjacency.get(current) ?? [];
      for (const n of next) {
        if (!seen.has(n)) stack.push(n);
      }
    }
    return false;
  };

  const dagEdges = parsedEdges.filter(
    (edge) => edge.source !== edge.target && !hasPath(edge.target, edge.source),
  );
  const dagAdj = new Map<string, string[]>();
  const dagIndegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const id of nodeIds) dagAdj.set(id, []);
  for (const edge of dagEdges) {
    dagAdj.get(edge.source)!.push(edge.target);
    dagIndegree.set(edge.target, (dagIndegree.get(edge.target) ?? 0) + 1);
  }

  const roots = nodeIds.filter((id) => (dagIndegree.get(id) ?? 0) === 0);
  if (roots.length === 0 && nodeIds.length > 0) roots.push(nodeIds[0]!);

  const topoQueue = [...roots];
  const topo: string[] = [];
  const indegMutable = new Map(dagIndegree);
  while (topoQueue.length > 0) {
    const current = topoQueue.shift()!;
    topo.push(current);
    for (const next of dagAdj.get(current) ?? []) {
      indegMutable.set(next, (indegMutable.get(next) ?? 0) - 1);
      if ((indegMutable.get(next) ?? 0) <= 0) topoQueue.push(next);
    }
  }
  for (const id of nodeIds) {
    if (!topo.includes(id)) topo.push(id);
  }

  const levels = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const root of roots) levels.set(root, 0);
  for (const current of topo) {
    const currentLevel = levels.get(current) ?? 0;
    for (const next of dagAdj.get(current) ?? []) {
      levels.set(next, Math.max(levels.get(next) ?? 0, currentLevel + 1));
    }
  }
  type Section = "storage" | "cold" | "idle" | "reconnect" | "user" | "misc";
  const detectSection = (id: string): Section => {
    const upper = id.toUpperCase();
    const sg = nodeSubgraph.get(id);
    if (typeof sg === "string" && /storage/i.test(sg)) return "storage";
    if (upper.startsWith("ST_") || upper === "STORAGE") return "storage";
    if (upper.startsWith("CS") || upper === "APPSTART" || upper === "APPEND") return "cold";
    if (upper.startsWith("IL_") || upper === "IDLE_LOOP") return "idle";
    if (
      upper.startsWith("RC_") ||
      upper === "RECONN" ||
      upper.startsWith("OL_") ||
      upper === "POLL_LOOP"
    )
      return "reconnect";
    if (upper.startsWith("UA_") || upper === "UA_TRIGGER") return "user";
    return "misc";
  };

  const sectionById = new Map<string, Section>();
  for (const id of nodeIds) sectionById.set(id, detectSection(id));
  for (let pass = 0; pass < 3; pass += 1) {
    for (const id of nodeIds) {
      if (sectionById.get(id) !== "misc") continue;
      const neighbors = [...(reverseAdjacency.get(id) ?? []), ...(adjacency.get(id) ?? [])];
      const candidate = neighbors.map((n) => sectionById.get(n)).find((s) => s && s !== "misc");
      if (candidate && candidate !== "misc") sectionById.set(id, candidate);
    }
  }

  const laneBaseY: Record<Section, number> = {
    storage: -860,
    cold: -260,
    idle: 760,
    reconnect: 1700,
    user: 620,
    misc: 2500,
  };
  const laneYGap: Record<Section, number> = {
    storage: 0,
    cold: 300,
    idle: 280,
    reconnect: 300,
    user: 280,
    misc: 300,
  };
  const position = new Map<string, { x: number; y: number }>();
  const nodeSize = new Map<string, { width: number; height: number }>();

  const estimateNodeSize = (id: string): { width: number; height: number } => {
    const meta = nodeMeta.get(id);
    const label = (meta?.label ?? id).replace(/<br\/>/g, "\n");
    const lines = label.split(/\n+/).map((line) => line.trim());
    const longest = lines.reduce((m, line) => Math.max(m, line.length), 0);
    const width = Math.max(190, Math.min(460, longest * 7.2 + 72));
    const height = Math.max(78, Math.min(240, lines.length * 18 + 54));
    return { width, height };
  };
  for (const id of nodeIds) nodeSize.set(id, estimateNodeSize(id));

  // Storage: pinned horizontal top strip.
  const storageNodes = nodeIds
    .filter((id) => sectionById.get(id) === "storage")
    .sort((a, b) => a.localeCompare(b));
  const storagePadding = 88;
  const storageTotal = storageNodes.reduce((sum, id) => sum + (nodeSize.get(id)?.width ?? 260), 0);
  const storageFull = storageTotal + Math.max(0, storageNodes.length - 1) * storagePadding;
  let storageCursor = -storageFull / 2;
  for (const id of storageNodes) {
    const width = nodeSize.get(id)?.width ?? 260;
    position.set(id, { x: storageCursor + width / 2, y: laneBaseY.storage });
    storageCursor += width + storagePadding;
    levels.set(id, 0);
  }

  // Per-section local layering; lane centers are assigned dynamically from computed widths.
  const rootBySection: Partial<Record<Section, string[]>> = {
    cold: ["APPSTART", "CS1"],
    idle: ["IDLE_LOOP", "IL_WAIT"],
    reconnect: ["RECONN"],
    user: ["UA_TRIGGER", "UA_WHICH"],
  };
  const sections: Section[] = ["cold", "idle", "reconnect", "user", "misc"];
  const sectionOrder: Section[] = ["user", "idle", "cold", "reconnect", "misc"];
  const sectionRows = new Map<
    Section,
    { sortedLevels: number[]; orderByLevel: Map<number, string[]> }
  >();
  const sectionWidths = new Map<Section, number>();

  for (const section of sections) {
    const members = nodeIds.filter((id) => sectionById.get(id) === section);
    if (members.length === 0) continue;

    const memberSet = new Set(members);
    const localAdj = new Map<string, string[]>();
    const localRev = new Map<string, string[]>();
    for (const id of members) {
      localAdj.set(
        id,
        (dagAdj.get(id) ?? []).filter((n) => memberSet.has(n)),
      );
      localRev.set(
        id,
        (reverseAdjacency.get(id) ?? []).filter((n) => memberSet.has(n)),
      );
    }

    const preferredRoots = (rootBySection[section] ?? []).filter((id) => memberSet.has(id));
    const inferredRoots = members.filter((id) => (localRev.get(id)?.length ?? 0) === 0);
    const rootsLocal =
      preferredRoots.length > 0
        ? preferredRoots
        : inferredRoots.length > 0
          ? inferredRoots
          : [members[0]!];

    const localLevel = new Map<string, number>();
    const q = [...rootsLocal];
    for (const root of rootsLocal) localLevel.set(root, 0);
    while (q.length > 0) {
      const current = q.shift()!;
      const curLevel = localLevel.get(current) ?? 0;
      for (const next of localAdj.get(current) ?? []) {
        const prev = localLevel.get(next);
        if (prev === undefined || prev < curLevel + 1) {
          localLevel.set(next, curLevel + 1);
          q.push(next);
        }
      }
    }
    let fallbackLevel = Math.max(0, ...Array.from(localLevel.values()));
    for (const id of members) {
      if (!localLevel.has(id)) {
        fallbackLevel += 1;
        localLevel.set(id, fallbackLevel);
      }
    }

    const groups = new Map<number, string[]>();
    for (const id of members) {
      const level = localLevel.get(id) ?? 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level)!.push(id);
    }
    const sortedLevels = Array.from(groups.keys()).sort((a, b) => a - b);
    const orderByLevel = new Map<number, string[]>();
    for (const level of sortedLevels)
      orderByLevel.set(
        level,
        [...(groups.get(level) ?? [])].sort((a, b) => a.localeCompare(b)),
      );

    const idx = (level: number, id: string): number => (orderByLevel.get(level) ?? []).indexOf(id);
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 1; i < sortedLevels.length; i += 1) {
        const level = sortedLevels[i]!;
        const prev = sortedLevels[i - 1]!;
        const row = orderByLevel.get(level) ?? [];
        const scored = row.map((id, j) => {
          const neigh = (localRev.get(id) ?? []).filter((n) => (localLevel.get(n) ?? 0) === prev);
          const score =
            neigh.length === 0
              ? j
              : neigh.reduce((s, n) => s + Math.max(0, idx(prev, n)), 0) / neigh.length;
          return { id, score, j };
        });
        scored.sort((a, b) => a.score - b.score || a.j - b.j);
        orderByLevel.set(
          level,
          scored.map((x) => x.id),
        );
      }
      for (let i = sortedLevels.length - 2; i >= 0; i -= 1) {
        const level = sortedLevels[i]!;
        const next = sortedLevels[i + 1]!;
        const row = orderByLevel.get(level) ?? [];
        const scored = row.map((id, j) => {
          const neigh = (localAdj.get(id) ?? []).filter((n) => (localLevel.get(n) ?? 0) === next);
          const score =
            neigh.length === 0
              ? j
              : neigh.reduce((s, n) => s + Math.max(0, idx(next, n)), 0) / neigh.length;
          return { id, score, j };
        });
        scored.sort((a, b) => a.score - b.score || a.j - b.j);
        orderByLevel.set(
          level,
          scored.map((x) => x.id),
        );
      }
    }

    const rowPadding = 92;
    let maxWidth = 0;
    for (const level of sortedLevels) {
      const idsInLevel = orderByLevel.get(level) ?? [];
      const totalWidth = idsInLevel.reduce((sum, id) => sum + (nodeSize.get(id)?.width ?? 260), 0);
      const fullWidth = totalWidth + Math.max(0, idsInLevel.length - 1) * rowPadding;
      if (fullWidth > maxWidth) maxWidth = fullWidth;
    }
    sectionRows.set(section, { sortedLevels, orderByLevel });
    sectionWidths.set(section, Math.max(520, maxWidth + 120));
  }

  // Dynamic lane centers prevent horizontal overlap between sections.
  const available = sectionOrder.filter((s) => sectionRows.has(s));
  const laneGap = 980;
  const totalSpan =
    available.reduce((sum, s) => sum + (sectionWidths.get(s) ?? 600), 0) +
    Math.max(0, available.length - 1) * laneGap;
  let cursorX = -totalSpan / 2;
  const laneCenter = new Map<Section, number>();
  for (const section of available) {
    const width = sectionWidths.get(section) ?? 600;
    laneCenter.set(section, cursorX + width / 2);
    cursorX += width + laneGap;
  }

  for (const section of available) {
    const laneX = laneCenter.get(section) ?? 0;
    const rows = sectionRows.get(section);
    if (!rows) continue;
    for (const level of rows.sortedLevels) {
      const idsInLevel = rows.orderByLevel.get(level) ?? [];
      const totalWidth = idsInLevel.reduce((sum, id) => sum + (nodeSize.get(id)?.width ?? 260), 0);
      const fullWidth = totalWidth + Math.max(0, idsInLevel.length - 1) * 92;
      let rowCursor = laneX - fullWidth / 2;
      for (const id of idsInLevel) {
        const width = nodeSize.get(id)?.width ?? 260;
        position.set(id, {
          x: rowCursor + width / 2,
          y: laneBaseY[section] + level * laneYGap[section],
        });
        rowCursor += width + 92;
      }
    }
  }

  // Global overlap pass (non-storage): separate overlapping nodes in both axes.
  const paddedBounds = (id: string): { l: number; r: number; t: number; b: number } => {
    const pos = position.get(id) ?? { x: 0, y: 0 };
    const size = nodeSize.get(id) ?? { width: 260, height: 90 };
    const padX = 72;
    const padY = 52;
    return {
      l: pos.x - size.width / 2 - padX,
      r: pos.x + size.width / 2 + padX,
      t: pos.y - size.height / 2 - padY,
      b: pos.y + size.height / 2 + padY,
    };
  };

  const movable = nodeIds.filter((id) => sectionById.get(id) !== "storage");
  for (let pass = 0; pass < 10; pass += 1) {
    for (let i = 0; i < movable.length; i += 1) {
      const a = movable[i]!;
      const pa = position.get(a)!;
      const ba = paddedBounds(a);
      for (let j = i + 1; j < movable.length; j += 1) {
        const b = movable[j]!;
        const pb = position.get(b)!;
        const bb = paddedBounds(b);
        const overlapX = Math.min(ba.r, bb.r) - Math.max(ba.l, bb.l);
        const overlapY = Math.min(ba.b, bb.b) - Math.max(ba.t, bb.t);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const push = overlapX / 2 + 44;
          const dir = pa.x <= pb.x ? 1 : -1;
          position.set(a, { x: pa.x - push * dir, y: pa.y });
          position.set(b, { x: pb.x + push * dir, y: pb.y });
        } else {
          const push = overlapY / 2 + 34;
          const dir = pa.y <= pb.y ? 1 : -1;
          position.set(a, { x: pa.x, y: pa.y - push * dir });
          position.set(b, { x: pb.x, y: pb.y + push * dir });
        }
      }
    }
  }

  const nodes: MindmapNode[] = Array.from(ids).map((id, index) => {
    const meta = nodeMeta.get(id) ?? {};
    const classPalette = meta.className ? classDefs.get(meta.className) : undefined;
    const inlineStyle = meta.style ?? {};
    const palette = {
      bg: inlineStyle.bg ?? classPalette?.bg,
      border: inlineStyle.border ?? classPalette?.border,
      text: inlineStyle.text ?? classPalette?.text,
    };
    const mappedShape =
      meta.className === "decision"
        ? "diamond"
        : meta.className === "startEnd"
          ? "pill"
          : "rounded";
    return {
      id,
      type: "mindmap",
      position: position.get(id) ?? { x: (index % 5) * 280, y: Math.floor(index / 5) * 180 },
      data: defaultNodeData({
        label: (meta.label ?? id).replace(/<br\/>/g, "\n"),
        bgColor: palette.bg ?? "",
        borderColor: palette.border ?? "",
        textColor: palette.text ?? "",
        shape: mappedShape,
      }),
    };
  });

  const edges: MindmapEdge[] = parsedEdges.map((edge, index) => {
    const sourcePos = position.get(edge.source) ?? { x: 0, y: 0 };
    const targetPos = position.get(edge.target) ?? { x: 0, y: 0 };
    const dx = targetPos.x - sourcePos.x;
    const dy = targetPos.y - sourcePos.y;
    const crossSection = sectionById.get(edge.source) !== sectionById.get(edge.target);
    const handles = crossSection
      ? Math.abs(dx) >= Math.abs(dy)
        ? dx >= 0
          ? { sourceHandle: "right-source", targetHandle: "left-target" }
          : { sourceHandle: "left-source", targetHandle: "right-target" }
        : dy >= 0
          ? { sourceHandle: "bottom-source", targetHandle: "top-target" }
          : { sourceHandle: "top-source", targetHandle: "bottom-target" }
      : dy >= 0
        ? { sourceHandle: "bottom-source", targetHandle: "top-target" }
        : { sourceHandle: "top-source", targetHandle: "bottom-target" };
    return {
      ...handles,
      id: `edge-import-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      source: edge.source,
      target: edge.target,
      type: "default",
      label: edge.label,
      animated: true,
      className: edgeClassName("solid", true),
      style: {
        strokeWidth: DEFAULT_EDGE_THICKNESS,
        stroke: DEFAULT_EDGE_COLOR,
        strokeDasharray: edgeDashFromPattern("solid"),
        strokeLinecap: "butt",
      },
      data: {
        label: edge.label,
        style: "bezier",
        pattern: "solid",
        color: DEFAULT_EDGE_COLOR,
        animated: true,
        thickness: DEFAULT_EDGE_THICKNESS,
      },
    };
  });

  return { nodes, edges };
}
