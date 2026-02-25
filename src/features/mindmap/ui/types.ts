import type { Node, Edge } from "@xyflow/react";

/* ═══════════════════════ Node types ═══════════════════════ */

export type NodePriority = "none" | "low" | "medium" | "high" | "critical";
export type NodeShape = "rounded" | "pill" | "diamond" | "hexagon";

export type MindmapNodeData = {
    label: string;
    description: string;
    priority: NodePriority;
    shape: NodeShape;
    icon: string;
    bgColor: string;
    borderColor: string;
    textColor: string;
    progress: number; // 0-100
    progressVisible: boolean;
    collapsed: boolean;
    tags: string[];
    createdAt: string;
    /** depth in hierarchy – 0 = root */
    depth: number;
};

export type MindmapNode = Node<MindmapNodeData, "mindmap">;

/* ═══════════════════════ Edge types ═══════════════════════ */

export type EdgeStyle = "bezier" | "straight" | "step" | "smoothstep";
export type EdgePattern = "solid" | "dashed" | "dotted";

export type MindmapEdgeData = {
    label: string;
    style: EdgeStyle;
    pattern: EdgePattern;
    color: string;
    animated: boolean;
    thickness: number;
};

export type MindmapEdge = Edge<MindmapEdgeData>;

/* ═══════════════════════ Layout ═══════════════════════ */

export type LayoutMode = "mindmap" | "tree-vertical" | "tree-horizontal" | "radial" | "org-chart" | "free";

/* ═══════════════════════ Theme ═══════════════════════ */

export type ThemePreset = {
    id: string;
    name: string;
    rootBg: string;
    rootBorder: string;
    rootText: string;
    branchBg: string;
    branchBorder: string;
    branchText: string;
    leafBg: string;
    leafBorder: string;
    leafText: string;
    edgeColor: string;
    canvasBg: string;
    dotColor: string;
};

/* ═══════════════════════ History (undo/redo) ═══════════════════════ */

export type MindmapSnapshot = {
    nodes: MindmapNode[];
    edges: MindmapEdge[];
};

export type MindmapHistory = {
    past: MindmapSnapshot[];
    future: MindmapSnapshot[];
};

/* ═══════════════════════ Constants ═══════════════════════ */

export const PRIORITY_META: Record<NodePriority, { label: string; color: string; badge: string }> = {
    none: { label: "None", color: "transparent", badge: "" },
    low: { label: "Low", color: "#7f8898", badge: "↓" },
    medium: { label: "Medium", color: "#2f8fff", badge: "→" },
    high: { label: "High", color: "#f0a43d", badge: "↑" },
    critical: { label: "Urgent", color: "#ff5252", badge: "△" },
};

export const THEME_PRESETS: ThemePreset[] = [
    {
        id: "midnight",
        name: "Midnight",
        rootBg: "#1e1b4b",
        rootBorder: "#6366f1",
        rootText: "#e0e7ff",
        branchBg: "#1a1a2e",
        branchBorder: "#374191",
        branchText: "#c7d2fe",
        leafBg: "#151525",
        leafBorder: "#2d2d5e",
        leafText: "#a5b4fc",
        edgeColor: "#6366f1",
        canvasBg: "#0a0a14",
        dotColor: "#1e1e3e",
    },
    {
        id: "forest",
        name: "Forest",
        rootBg: "#052e16",
        rootBorder: "#16a34a",
        rootText: "#dcfce7",
        branchBg: "#0a2118",
        branchBorder: "#15803d",
        branchText: "#bbf7d0",
        leafBg: "#0d1f17",
        leafBorder: "#166534",
        leafText: "#86efac",
        edgeColor: "#22c55e",
        canvasBg: "#060f0a",
        dotColor: "#0f2a1a",
    },
    {
        id: "ocean",
        name: "Ocean",
        rootBg: "#0c1e3a",
        rootBorder: "#0ea5e9",
        rootText: "#e0f2fe",
        branchBg: "#0a1929",
        branchBorder: "#0284c7",
        branchText: "#bae6fd",
        leafBg: "#081420",
        leafBorder: "#0369a1",
        leafText: "#7dd3fc",
        edgeColor: "#38bdf8",
        canvasBg: "#060d18",
        dotColor: "#0c2240",
    },
    {
        id: "ember",
        name: "Ember",
        rootBg: "#3b0a0a",
        rootBorder: "#ef4444",
        rootText: "#fee2e2",
        branchBg: "#2a0e0e",
        branchBorder: "#dc2626",
        branchText: "#fecaca",
        leafBg: "#1f0d0d",
        leafBorder: "#b91c1c",
        leafText: "#fca5a5",
        edgeColor: "#ef4444",
        canvasBg: "#120808",
        dotColor: "#2a1010",
    },
    {
        id: "neutral",
        name: "Neutral",
        rootBg: "#1c1c1c",
        rootBorder: "#6b7280",
        rootText: "#f3f4f6",
        branchBg: "#171717",
        branchBorder: "#4b5563",
        branchText: "#d1d5db",
        leafBg: "#141414",
        leafBorder: "#374151",
        leafText: "#9ca3af",
        edgeColor: "#6b7280",
        canvasBg: "#0c0c0c",
        dotColor: "#1a1a1a",
    },
];

export function defaultNodeData(overrides: Partial<MindmapNodeData> = {}): MindmapNodeData {
    return {
        label: "New Node",
        description: "",
        priority: "none",
        shape: "rounded",
        icon: "",
        bgColor: "",
        borderColor: "",
        textColor: "",
        progress: 0,
        progressVisible: false,
        collapsed: false,
        tags: [],
        createdAt: new Date().toISOString(),
        depth: 0,
        ...overrides,
    };
}
