// Pure helpers behind the Mindmap canvas: the edge a connection becomes, the
// styled edge each menu choice produces, and the shape a saved document takes
// when it loads (older nodes carried category/type/emoji fields).

import {
  DEFAULT_EDGE_COLOR,
  DEFAULT_EDGE_THICKNESS,
  edgeClassName,
  edgeDashFromPattern,
  edgeTypeFromStyle,
  normalizeEdgeData,
} from "./edge-style";
import { normalizeNodeIcon } from "./node-icons";
import type { EdgePattern, EdgeStyle, MindmapEdge, MindmapEdgeData, MindmapNode } from "./types";
import { defaultNodeData } from "./types";

export function createConnectionEdge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): MindmapEdge {
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
}

/** A saved document's nodes, migrated to the current shape. */
export function normalizeLoadedNodes(rawNodes: any[]): MindmapNode[] {
  return rawNodes.map((n) => {
    const legacyData = n.data ?? {};
    const {
      category: _legacyCategory,
      type: _legacyType,
      emoji: legacyEmoji,
      icon: rawIcon,
      ...restData
    } = legacyData;
    const icon = normalizeNodeIcon(rawIcon, legacyEmoji);
    const legacyProgressRaw = Number(restData.progress ?? 0);
    const legacyProgress = Number.isFinite(legacyProgressRaw)
      ? Math.max(0, Math.min(100, legacyProgressRaw))
      : 0;
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
}

/** A saved document's edges, with their style fields rebuilt from the edge data. */
export function normalizeLoadedEdges(rawEdges: MindmapEdge[]): MindmapEdge[] {
  return rawEdges.map((edge: MindmapEdge) => {
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
}

export function withEdgeLabel(edge: MindmapEdge, label: string): MindmapEdge {
  const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
  return {
    ...edge,
    label,
    data: { ...data, label },
  };
}

export function withEdgeColor(edge: MindmapEdge, color: string): MindmapEdge {
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
}

export function withEdgeShape(edge: MindmapEdge, styleValue: EdgeStyle): MindmapEdge {
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
}

export function withEdgePattern(edge: MindmapEdge, pattern: EdgePattern): MindmapEdge {
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
}

export function withEdgeAnimation(edge: MindmapEdge, animated: boolean): MindmapEdge {
  const data = normalizeEdgeData(edge, DEFAULT_EDGE_COLOR);
  return {
    ...edge,
    animated,
    className: edgeClassName(data.pattern, animated),
    data: { ...data, animated },
  };
}
