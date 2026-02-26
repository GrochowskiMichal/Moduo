import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ReactFlow,
  reconnectEdge,
  applyNodeChanges,
  applyEdgeChanges,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
} from "@xyflow/react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { MindmapCustomNode } from "./custom-node";
import { MindmapMiniMap } from "./components/mindmap-mini-map";
import { MindmapToolbar } from "./components/mindmap-toolbar";
import { MindmapRelations } from "./components/mindmap-relations";
import { MINDMAP_SELECT_MAP_EVENT, type MindmapSelectMapDetail } from "./layout-events";
import { useMindmapHistory } from "./hooks/use-mindmap-history";
import {
  listMindmaps,
  loadMindmapDocument,
  readStoredActiveMindmap,
  saveMindmapDocument,
} from "./mindmap-storage";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import type { ModuoRuntime } from "../../../lib/runtime";
import type {
  MindmapNode,
  MindmapEdge,
  MindmapEdgeData,
  EdgeStyle,
  EdgePattern,
} from "./types";
import { defaultNodeData, THEME_PRESETS } from "./types";
import { normalizeNodeIcon } from "./node-icons";
import "@xyflow/react/dist/style.css";

/* ═══════════════════════ Constants ═══════════════════════ */

const nodeTypes: NodeTypes = { mindmap: MindmapCustomNode };

const DEFAULT_THEME = THEME_PRESETS[4]!; // Neutral
const DEFAULT_EDGE_COLOR = "#ffffff";
const DEFAULT_EDGE_THICKNESS = 2;
const EDGE_SHAPE_OPTIONS: { value: EdgeStyle; icon: string; label: string }[] = [
  { value: "bezier", icon: "∿", label: "Bezier" },
  { value: "straight", icon: "⎯", label: "Straight" },
  { value: "step", icon: "┐", label: "Step" },
  { value: "smoothstep", icon: "≈", label: "Smooth" },
];

type EdgeMenuPanel = "text" | "color" | "shape" | "line" | null;
type EdgeMenuState = {
  edgeId: string;
  x: number;
  y: number;
  panel: EdgeMenuPanel;
};

function edgeStyleFromType(typeValue: string | undefined): EdgeStyle {
  if (typeValue === "straight" || typeValue === "step" || typeValue === "smoothstep") return typeValue;
  return "bezier";
}

function edgeTypeFromStyle(style: EdgeStyle): string {
  if (style === "bezier") return "default";
  return style;
}

function normalizeEdgeData(edge: MindmapEdge, fallbackColor: string): MindmapEdgeData {
  const color = typeof edge.data?.color === "string" ? edge.data.color : String(edge.style?.stroke ?? fallbackColor);
  const thicknessRaw = Number(edge.data?.thickness ?? edge.style?.strokeWidth ?? DEFAULT_EDGE_THICKNESS);
  const thickness = Number.isFinite(thicknessRaw) && thicknessRaw > 0 ? thicknessRaw : DEFAULT_EDGE_THICKNESS;
  const label = typeof edge.data?.label === "string" ? edge.data.label : typeof edge.label === "string" ? edge.label : "";
  const styleCandidate = edge.data?.style;
  const style =
    styleCandidate === "bezier" || styleCandidate === "straight" || styleCandidate === "step" || styleCandidate === "smoothstep"
      ? styleCandidate
      : edgeStyleFromType(edge.type);
  const dashRaw = edge.style?.strokeDasharray;
  const patternFromStroke =
    dashRaw === "7 6" ? "dashed" : dashRaw === "1 10" ? "dotted" : "solid";
  const patternCandidate = edge.data?.pattern;
  const pattern: EdgePattern =
    patternCandidate === "solid" || patternCandidate === "dashed" || patternCandidate === "dotted"
      ? patternCandidate
      : patternFromStroke;
  return {
    label,
    style,
    pattern,
    color,
    animated: edge.data?.animated ?? edge.animated ?? true,
    thickness,
  };
}

function edgeDashFromPattern(pattern: EdgePattern): string | undefined {
  if (pattern === "dashed") return "7 6";
  if (pattern === "dotted") return "1 10";
  return undefined;
}

function edgeClassFromPattern(pattern: EdgePattern): string | undefined {
  if (pattern === "solid") return "mindmap-edge-solid-animated";
  if (pattern === "dashed") return "mindmap-edge-dashed";
  if (pattern === "dotted") return "mindmap-edge-dotted";
  return undefined;
}

function edgeClassName(pattern: EdgePattern, animated: boolean): string {
  const base = edgeClassFromPattern(pattern) ?? "";
  return `${base}${animated ? "" : " mindmap-edge-no-anim"}`.trim();
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function edgeAnimatedFromPattern(pattern: EdgePattern): boolean {
  return pattern !== "solid";
}

function parseMermaidToMindmap(source: string): { nodes: MindmapNode[]; edges: MindmapEdge[] } {
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
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\n/g, "\n");
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
      label = label.replace(/\\"/g, "\"").replace(/\\n/g, "\n");
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
      const idList = classAssignMatch[1]!.split(",").map((s) => s.trim()).filter(Boolean);
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
      registerNode(sourceParsed.id, { label: sourceParsed.label, className: sourceParsed.className });
      registerNode(targetParsed.id, { label: targetParsed.label, className: targetParsed.className });
      parsedEdges.push({ source: sourceParsed.id, target: targetParsed.id, label: cleanEdgeLabel(edgePiped[2]!) });
      continue;
    }

    const edgeLabeled = line.match(/^(.*?)\s*--\s*(.*?)\s*-->\s*(.+)$/);
    if (edgeLabeled) {
      const sourceParsed = parseEndpoint(edgeLabeled[1]!);
      const targetParsed = parseEndpoint(edgeLabeled[3]!);
      if (!sourceParsed || !targetParsed) continue;
      registerNode(sourceParsed.id, { label: sourceParsed.label, className: sourceParsed.className });
      registerNode(targetParsed.id, { label: targetParsed.label, className: targetParsed.className });
      parsedEdges.push({ source: sourceParsed.id, target: targetParsed.id, label: cleanEdgeLabel(edgeLabeled[2]!) });
      continue;
    }

    const edgeSimple = line.match(/^(.*?)\s*-->\s*(.+)$/);
    if (edgeSimple) {
      const sourceParsed = parseEndpoint(edgeSimple[1]!);
      const targetParsed = parseEndpoint(edgeSimple[2]!);
      if (!sourceParsed || !targetParsed) continue;
      registerNode(sourceParsed.id, { label: sourceParsed.label, className: sourceParsed.className });
      registerNode(targetParsed.id, { label: targetParsed.label, className: targetParsed.className });
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
    throw new Error("No Mermaid nodes found. Expected lines like A[\"Label\"] and A --> B.");
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

  const dagEdges = parsedEdges.filter((edge) => edge.source !== edge.target && !hasPath(edge.target, edge.source));
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
    if (upper.startsWith("RC_") || upper === "RECONN" || upper.startsWith("OL_") || upper === "POLL_LOOP") return "reconnect";
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
  const storageNodes = nodeIds.filter((id) => sectionById.get(id) === "storage").sort((a, b) => a.localeCompare(b));
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
  const sectionRows = new Map<Section, { sortedLevels: number[]; orderByLevel: Map<number, string[]> }>();
  const sectionWidths = new Map<Section, number>();

  for (const section of sections) {
    const members = nodeIds.filter((id) => sectionById.get(id) === section);
    if (members.length === 0) continue;

    const memberSet = new Set(members);
    const localAdj = new Map<string, string[]>();
    const localRev = new Map<string, string[]>();
    for (const id of members) {
      localAdj.set(id, (dagAdj.get(id) ?? []).filter((n) => memberSet.has(n)));
      localRev.set(id, (reverseAdjacency.get(id) ?? []).filter((n) => memberSet.has(n)));
    }

    const preferredRoots = (rootBySection[section] ?? []).filter((id) => memberSet.has(id));
    const inferredRoots = members.filter((id) => (localRev.get(id)?.length ?? 0) === 0);
    const rootsLocal = preferredRoots.length > 0 ? preferredRoots : inferredRoots.length > 0 ? inferredRoots : [members[0]!];

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
    for (const level of sortedLevels) orderByLevel.set(level, [...(groups.get(level) ?? [])].sort((a, b) => a.localeCompare(b)));

    const idx = (level: number, id: string): number => (orderByLevel.get(level) ?? []).indexOf(id);
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 1; i < sortedLevels.length; i += 1) {
        const level = sortedLevels[i]!;
        const prev = sortedLevels[i - 1]!;
        const row = orderByLevel.get(level) ?? [];
        const scored = row.map((id, j) => {
          const neigh = (localRev.get(id) ?? []).filter((n) => (localLevel.get(n) ?? 0) === prev);
          const score = neigh.length === 0 ? j : neigh.reduce((s, n) => s + Math.max(0, idx(prev, n)), 0) / neigh.length;
          return { id, score, j };
        });
        scored.sort((a, b) => a.score - b.score || a.j - b.j);
        orderByLevel.set(level, scored.map((x) => x.id));
      }
      for (let i = sortedLevels.length - 2; i >= 0; i -= 1) {
        const level = sortedLevels[i]!;
        const next = sortedLevels[i + 1]!;
        const row = orderByLevel.get(level) ?? [];
        const scored = row.map((id, j) => {
          const neigh = (localAdj.get(id) ?? []).filter((n) => (localLevel.get(n) ?? 0) === next);
          const score = neigh.length === 0 ? j : neigh.reduce((s, n) => s + Math.max(0, idx(next, n)), 0) / neigh.length;
          return { id, score, j };
        });
        scored.sort((a, b) => a.score - b.score || a.j - b.j);
        orderByLevel.set(level, scored.map((x) => x.id));
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
        ? (dx >= 0
            ? { sourceHandle: "right-source", targetHandle: "left-target" }
            : { sourceHandle: "left-source", targetHandle: "right-target" })
        : (dy >= 0
            ? { sourceHandle: "bottom-source", targetHandle: "top-target" }
            : { sourceHandle: "top-source", targetHandle: "bottom-target" })
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
  const [isCommandMode, setIsCommandMode] = useState(false);
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState | null>(null);
  const [edgeColorDraft, setEdgeColorDraft] = useState("");
  const [selectedMindmapId, setSelectedMindmapId] = useState<string | null>(null);
  const [mindmapCount, setMindmapCount] = useState(0);
  const [isLoadingMindmap, setIsLoadingMindmap] = useState(false);

  // --- Visual settings ---
  const theme = DEFAULT_THEME;

  // --- Refs ---
  const isHydratingRef = useRef(false);
  const lastSavedSignatureRef = useRef("");
  const edgeMenuRef = useRef<HTMLDivElement | null>(null);

  // --- Hooks ---
  const history = useMindmapHistory();
  const reactFlowInstance = useReactFlow();

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
        const nextNodes: MindmapNode[] = rawNodes.map((n: any) => {
          const legacyData = n.data ?? {};
          const { category: _legacyCategory, type: _legacyType, emoji: legacyEmoji, icon: rawIcon, ...restData } = legacyData;
          const icon = normalizeNodeIcon(rawIcon, legacyEmoji);
          const legacyProgressRaw = Number(restData.progress ?? 0);
          const legacyProgress = Number.isFinite(legacyProgressRaw) ? Math.max(0, Math.min(100, legacyProgressRaw)) : 0;
          const progressVisible =
            typeof restData.progressVisible === "boolean" ? restData.progressVisible : legacyProgress > 0;
          return {
            ...n,
            type: "mindmap",
            data: {
              ...defaultNodeData(),
              ...restData,
              progress: legacyProgress,
              progressVisible,
              icon,
              tags: Array.isArray(restData.tags) ? restData.tags : [],
            },
          };
        });

        const rawEdges = Array.isArray(doc?.edges) ? doc.edges : [];
        const nextEdges: MindmapEdge[] = rawEdges.map((edge: MindmapEdge) => {
          const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
          return {
            ...edge,
            type: edgeTypeFromStyle(data.style),
            label: data.label,
            animated: data.animated,
            className: edgeClassName(data.pattern, data.animated),
            style: {
              ...(edge.style ?? {}),
              stroke: data.color,
              strokeWidth: data.thickness,
              strokeDasharray: edgeDashFromPattern(data.pattern),
              strokeLinecap: data.pattern === "dotted" ? "round" : "butt",
            },
            data: { ...data, animated: data.animated },
          };
        });
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
        if (!active) return;
        isHydratingRef.current = false;
        setIsLoadingMindmap(false);
      }
    };
    void load();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        .then(() => { lastSavedSignatureRef.current = signature; })
        .catch((err) => console.error("Failed to auto-save mindmap", err));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [runtime, workspaceId, selectedMindmapId, nodes, edges]);

  /* ─── React Flow handlers ─── */

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((cur) => applyNodeChanges(changes, cur) as MindmapNode[]);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((cur) => applyEdgeChanges(changes, cur) as MindmapEdge[]);
  }, []);

  const createConnectionEdge = useCallback(
    (source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): MindmapEdge => {
      const data: MindmapEdgeData = {
        label: "",
        style: "bezier",
        pattern: "solid",
        color: DEFAULT_EDGE_COLOR,
        animated: true,
        thickness: DEFAULT_EDGE_THICKNESS,
      };
      return {
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source,
        target,
        sourceHandle: sourceHandle ?? undefined,
        targetHandle: targetHandle ?? undefined,
        type: edgeTypeFromStyle(data.style),
        label: data.label,
        animated: data.animated,
        className: edgeClassName(data.pattern, data.animated),
        style: {
          strokeWidth: data.thickness,
          stroke: data.color,
          strokeDasharray: edgeDashFromPattern(data.pattern),
          strokeLinecap: data.pattern === "dotted" ? "round" : "butt",
        },
        data,
      } as MindmapEdge;
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const duplicateExists = edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
          (edge.targetHandle ?? null) === (connection.targetHandle ?? null)
      );
      if (duplicateExists) return;
      history.pushSnapshot(nodes, edges);
      setEdges((cur) =>
        cur.concat(createConnectionEdge(connection.source!, connection.target!, connection.sourceHandle, connection.targetHandle))
      );
    },
    [createConnectionEdge, nodes, edges, history]
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
      const maxX = typeof window === "undefined" ? event.clientX : Math.max(12, window.innerWidth - menuWidth - 12);
      const maxY = typeof window === "undefined" ? event.clientY : Math.max(12, window.innerHeight - menuHeight - 12);
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
          (edge.targetHandle ?? null) === (newConnection.targetHandle ?? null)
      );
      if (duplicateExists) return;
      history.pushSnapshot(nodes, edges);
      setEdges((current) => reconnectEdge(oldEdge, newConnection, current) as MindmapEdge[]);
    },
    [edges, history, nodes]
  );

  const updateEdgeRecord = useCallback((edgeId: string, updater: (edge: MindmapEdge) => MindmapEdge) => {
    setEdges((current) => current.map((edge) => (edge.id === edgeId ? updater(edge) : edge)));
  }, []);

  const updateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      updateEdgeRecord(edgeId, (edge) => {
        const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
        return {
          ...edge,
          label,
          data: { ...data, label },
        };
      });
    },
    [updateEdgeRecord]
  );

  const applyEdgeColor = useCallback(
    (edgeId: string, color: string, withHistory = true) => {
      if (withHistory) history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => {
        const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
        return {
          ...edge,
          animated: data.animated,
          className: edgeClassName(data.pattern, data.animated),
          style: {
            ...(edge.style ?? {}),
            stroke: color,
            strokeWidth: data.thickness,
            strokeDasharray: edgeDashFromPattern(data.pattern),
            strokeLinecap: data.pattern === "dotted" ? "round" : "butt",
          },
          data: { ...data, color, animated: data.animated },
        };
      });
    },
    [history, nodes, edges, updateEdgeRecord]
  );

  const applyEdgeShape = useCallback(
    (edgeId: string, styleValue: EdgeStyle) => {
      history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => {
        const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
        return {
          ...edge,
          type: edgeTypeFromStyle(styleValue),
          animated: data.animated,
          className: edgeClassName(data.pattern, data.animated),
          style: {
            ...(edge.style ?? {}),
            stroke: data.color,
            strokeWidth: data.thickness,
            strokeDasharray: edgeDashFromPattern(data.pattern),
            strokeLinecap: data.pattern === "dotted" ? "round" : "butt",
          },
          data: { ...data, style: styleValue, animated: data.animated },
        };
      });
    },
    [history, nodes, edges, updateEdgeRecord]
  );

  const applyEdgePattern = useCallback(
    (edgeId: string, pattern: EdgePattern) => {
      history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => {
        const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
        const animated = data.animated;
        return {
          ...edge,
          animated,
          className: edgeClassName(pattern, animated),
          style: {
            ...(edge.style ?? {}),
            stroke: data.color,
            strokeWidth: data.thickness,
            strokeDasharray: edgeDashFromPattern(pattern),
            strokeLinecap: pattern === "dotted" ? "round" : "butt",
          },
          data: { ...data, pattern, animated },
        };
      });
    },
    [history, nodes, edges, updateEdgeRecord]
  );

  const applyEdgeAnimation = useCallback(
    (edgeId: string, animated: boolean) => {
      history.pushSnapshot(nodes, edges);
      updateEdgeRecord(edgeId, (edge) => {
        const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
        return {
          ...edge,
          animated,
          className: edgeClassName(data.pattern, animated),
          data: { ...data, animated },
        };
      });
    },
    [history, nodes, edges, updateEdgeRecord]
  );

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
      position: { x: centerX - 120 + Math.random() * 40 - 20, y: centerY - 40 + Math.random() * 40 - 20 },
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
        setNodes((cur) => cur.map((n) => (n.id === newNode.id ? { ...n, position: newNode.position, data: newNode.data } : n)));
      }
    } else {
      setNodes((cur) => cur.concat(newNode));
    }
  }, [pushHistory, reactFlowInstance, selectedNode, nodes, createConnectionEdge]);

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
      childOffsetCandidates.find((offset) => occupiedOffsets.every((taken) => Math.abs(taken - offset) > horizontalStep * 0.66)) ??
      (siblingNodes.length + 1) * horizontalStep;
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

    const newEdge = createConnectionEdge(selectedNode.id, childNode.id, "bottom-source", "top-target");

    setNodes((cur) => [...cur, childNode]);
    setEdges((cur) => [...cur, newEdge]);
    setSelectedNode(childNode);
  }, [selectedNode, pushHistory, createConnectionEdge, edges, nodes]);

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
  }, [selectedNode, edges, nodes, pushHistory, createConnectionEdge]);

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
        (edge) =>
          !edgeIds.has(edge.id) &&
          !nodeIds.has(edge.source) &&
          !nodeIds.has(edge.target)
      )
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
      (edge) => edgeIds.has(edge.id) || (nodeIds.has(edge.source) && nodeIds.has(edge.target))
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
          (existing.targetHandle ?? null) === (edge.targetHandle ?? null)
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
  }, [selectedNodeIds, selectedEdgeIds, selectedNode, duplicateSelectedNode, pushHistory, nodes, edges]);

  const deleteNodeById = useCallback((nodeId: string) => {
    pushHistory();
    setNodes((cur) => cur.filter((node) => node.id !== nodeId));
    setEdges((cur) => cur.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNode((cur) => (cur?.id === nodeId ? null : cur));
  }, [pushHistory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onNodeUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string; key: keyof MindmapNode["data"]; value: any }>).detail;
      if (!detail?.nodeId) return;
      setNodes((current) =>
        current.map((node) =>
          node.id === detail.nodeId ? { ...node, data: { ...node.data, [detail.key]: detail.value } } : node
        )
      );
      setSelectedNode((current) =>
        current?.id === detail.nodeId ? { ...current, data: { ...current.data, [detail.key]: detail.value } } : current
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
      requestAnimationFrame(() => { isHydratingRef.current = false; });
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
      requestAnimationFrame(() => { isHydratingRef.current = false; });
    }
  }, [history, nodes, edges]);

  /* ─── Keyboard shortcuts ─── */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onModifierChange = (event: KeyboardEvent) => {
      setIsCommandMode(event.metaKey || event.ctrlKey);
    };
    const onModifierUp = () => setIsCommandMode(false);
    window.addEventListener("keydown", onModifierChange);
    window.addEventListener("keyup", onModifierChange);
    window.addEventListener("blur", onModifierUp);
    return () => {
      window.removeEventListener("keydown", onModifierChange);
      window.removeEventListener("keyup", onModifierChange);
      window.removeEventListener("blur", onModifierUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Undo
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo
      if (meta && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (isInput) return;

      // N → add new node
      if (!meta && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        addNode();
        return;
      }

      // Cmd/Ctrl + D → duplicate selected node
      if (meta && (e.key === "d" || e.key === "D")) {
        if (selectedNode || selectedNodeIds.size > 0 || selectedEdgeIds.size > 0) {
          e.preventDefault();
          duplicateSelection();
        }
        return;
      }

      // Tab → add child
      if (e.key === "Tab" && selectedNode) {
        e.preventDefault();
        addChildNode();
        return;
      }

      // Enter → add sibling
      if (e.key === "Enter" && selectedNode) {
        e.preventDefault();
        addSiblingNode();
        return;
      }

      // Delete / Backspace → remove selected node/edge
      if (e.key === "Delete" || e.key === "Backspace") {
        if (e.key === "Backspace") e.preventDefault();
        if (selectedNodeIds.size > 0 || selectedEdgeIds.size > 0) {
          e.preventDefault();
          deleteSelection();
          return;
        }
        if (selectedNode) {
          e.preventDefault();
          deleteSelectedNode();
          return;
        }
        if (selectedEdgeId) {
          e.preventDefault();
          deleteSelectedEdge();
          return;
        }
        return;
      }

      // Escape
      if (e.key === "Escape") {
        if (edgeMenu) {
          setEdgeMenu(null);
          return;
        }
        if (selectedEdgeId) {
          setSelectedEdgeId(null);
          return;
        }
        setSelectedNode(null);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleUndo,
    handleRedo,
    addNode,
    selectedNode,
    selectedEdgeId,
    addChildNode,
    addSiblingNode,
    duplicateSelectedNode,
    duplicateSelection,
    deleteSelectedNode,
    deleteSelectedEdge,
    deleteSelection,
    edgeMenu,
    selectedNodeIds,
    selectedEdgeIds,
  ]);

  /* ─── Navigate to node ─── */

  const navigateToNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setSelectedNode(node);
      setSelectedEdgeId(null);
      setEdgeMenu(null);
      reactFlowInstance.setCenter(node.position.x + 120, node.position.y + 40, { zoom: 1.2, duration: 400 });
    },
    [nodes, reactFlowInstance]
  );

  const activeEdge = edgeMenu ? edges.find((edge) => edge.id === edgeMenu.edgeId) ?? null : null;
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
    [edges, selectedEdgeIds]
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
        const message = error instanceof Error ? error.message : "Failed to parse Mermaid notation.";
        return { ok: false, error: message };
      }
    },
    [pushHistory]
  );

  /* ─── Render ─── */

  let center: ReactNode = null;

  if (mindmapCount === 0) {
    center = (
      <div className="grid h-full place-content-center gap-3 text-center">
        <div className="text-[40px]" aria-hidden="true">🧠</div>
        <h2 className="text-[16px] font-bold text-[#c0c5d4]">No mindmaps yet</h2>
        <p className="text-[12px] text-[#5a5f6e] max-w-[280px]">
          Use the selector next to Mindmap in the top nav to create your first map.
        </p>
      </div>
    );
  } else if (!selectedMindmapId) {
    center = (
      <div className="grid h-full place-content-center gap-3 text-center">
        <div className="text-[40px]" aria-hidden="true">🎯</div>
        <h2 className="text-[16px] font-bold text-[#c0c5d4]">Select a mindmap</h2>
        <p className="text-[12px] text-[#5a5f6e]">Choose a mindmap from the top nav dropdown.</p>
      </div>
    );
  } else if (isLoadingMindmap) {
    center = (
      <div className="grid h-full place-content-center text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#303429] border-t-emerald-500" />
          <p className="text-[12px] text-[#7a846a]">Loading mindmap…</p>
        </div>
      </div>
    );
  } else {
    center = (
      <div className="relative -m-4 h-[calc(100%+2rem)] min-h-0 w-[calc(100%+2rem)]">
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
          <div
            ref={edgeMenuRef}
            className="fixed z-40 w-[min(220px,calc(100vw-24px))] rounded-xl border border-[#2a2a2a] bg-[#141414]/95 p-2 shadow-2xl backdrop-blur-xl"
            style={{ left: edgeMenu.x, top: edgeMenu.y }}
            role="dialog"
            aria-label="Connection style menu"
          >
            <div className="flex items-center gap-1">
              <button
                onClick={() => toggleEdgePanel("text")}
                className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
                  edgeMenu.panel === "text" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                }`}
                aria-label="Edit connection text"
              >
                T
              </button>
              <button
                onClick={() => toggleEdgePanel("color")}
                className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
                  edgeMenu.panel === "color" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                }`}
                aria-label="Edit connection color"
              >
                ◉
              </button>
              <button
                onClick={() => toggleEdgePanel("shape")}
                className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
                  edgeMenu.panel === "shape" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                }`}
                aria-label="Edit connection style"
              >
                ∿
              </button>
              <button
                onClick={() => toggleEdgePanel("line")}
                className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
                  edgeMenu.panel === "line" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                }`}
                aria-label="Edit connection line pattern"
              >
                ╌
              </button>
              <button
                onClick={() => applyEdgeAnimation(activeEdge.id, !activeEdgeData.animated)}
                className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
                  activeEdgeData.animated ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                }`}
                aria-label={activeEdgeData.animated ? "Disable connection animation" : "Enable connection animation"}
              >
                ◍
              </button>
            </div>

            <div className={`overflow-hidden transition-all duration-200 ease-out ${edgeMenu.panel ? "mt-2 max-h-20 opacity-100" : "max-h-0 opacity-0"}`}>
              {edgeMenu.panel === "text" ? (
                <input
                  value={activeEdgeData.label}
                  onChange={(event) => updateEdgeLabel(activeEdge.id, event.target.value)}
                  className="h-8 w-[204px] rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]"
                  placeholder="Connection text..."
                />
              ) : null}

              {edgeMenu.panel === "color" ? (
                <div className="grid gap-1">
                  <input
                    value={edgeColorDraft}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setEdgeColorDraft(nextValue);
                      const next = normalizeHexColor(nextValue);
                      if (next) applyEdgeColor(activeEdge.id, next, false);
                    }}
                    onBlur={() => {
                      const next = normalizeHexColor(edgeColorDraft);
                      if (next) {
                        applyEdgeColor(activeEdge.id, next, true);
                        setEdgeColorDraft(next);
                        return;
                      }
                      setEdgeColorDraft(activeEdgeData.color);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        (event.currentTarget as HTMLInputElement).blur();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEdgeColorDraft(activeEdgeData.color);
                        (event.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                    className="h-8 w-full rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 font-mono text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]"
                    placeholder="#ffffff"
                    maxLength={7}
                    aria-label="Connection color hex"
                  />
                </div>
              ) : null}

              {edgeMenu.panel === "shape" ? (
                <div className="grid grid-cols-4 gap-1">
                  {EDGE_SHAPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-200 hover:scale-[1.03] ${
                        activeEdgeData.style === option.value ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                      }`}
                      onClick={() => applyEdgeShape(activeEdge.id, option.value)}
                      aria-label={`Set connection style ${option.label}`}
                    >
                      <span className="animate-pulse text-[13px]">{option.icon}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {edgeMenu.panel === "line" ? (
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { value: "solid", icon: "—", label: "Solid" },
                    { value: "dashed", icon: "╌", label: "Dashed" },
                    { value: "dotted", icon: "⋯", label: "Dotted" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      className={`flex items-center justify-center rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-200 hover:scale-[1.03] ${
                        activeEdgeData.pattern === option.value ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                      }`}
                      onClick={() => applyEdgePattern(activeEdge.id, option.value as EdgePattern)}
                      aria-label={`Set connection line ${option.label}`}
                    >
                      <span className="text-[14px]">{option.icon}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
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

export function MindmapWorkspace({ workspaceId, runtime }: { workspaceId: string; runtime: ModuoRuntime }) {
  return (
    <ReactFlowProvider>
      <MindmapCanvas workspaceId={workspaceId} runtime={runtime} />
    </ReactFlowProvider>
  );
}
