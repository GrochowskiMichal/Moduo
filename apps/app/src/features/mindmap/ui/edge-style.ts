import type { EdgePattern, EdgeStyle, MindmapEdge, MindmapEdgeData } from "./types";
import { THEME_PRESETS } from "./types";

export const DEFAULT_THEME = THEME_PRESETS[4]!;
export const DEFAULT_EDGE_COLOR = "#ffffff";
export const DEFAULT_EDGE_THICKNESS = 2;

export const EDGE_SHAPE_OPTIONS: { value: EdgeStyle; icon: string; label: string }[] = [
  { value: "bezier", icon: "∿", label: "Bezier" },
  { value: "straight", icon: "⎯", label: "Straight" },
  { value: "step", icon: "┐", label: "Step" },
  { value: "smoothstep", icon: "≈", label: "Smooth" },
];

export type EdgeMenuPanel = "text" | "color" | "shape" | "line" | null;

export type EdgeMenuState = {
  edgeId: string;
  x: number;
  y: number;
  panel: EdgeMenuPanel;
};

function edgeStyleFromType(typeValue: string | undefined): EdgeStyle {
  if (typeValue === "straight" || typeValue === "step" || typeValue === "smoothstep")
    return typeValue;
  return "bezier";
}

export function edgeTypeFromStyle(style: EdgeStyle): string {
  if (style === "bezier") return "default";
  return style;
}

export function normalizeEdgeData(edge: MindmapEdge, fallbackColor: string): MindmapEdgeData {
  const color =
    typeof edge.data?.color === "string"
      ? edge.data.color
      : String(edge.style?.stroke ?? fallbackColor);
  const thicknessRaw = Number(
    edge.data?.thickness ?? edge.style?.strokeWidth ?? DEFAULT_EDGE_THICKNESS,
  );
  const thickness =
    Number.isFinite(thicknessRaw) && thicknessRaw > 0 ? thicknessRaw : DEFAULT_EDGE_THICKNESS;
  const label =
    typeof edge.data?.label === "string"
      ? edge.data.label
      : typeof edge.label === "string"
        ? edge.label
        : "";
  const styleCandidate = edge.data?.style;
  const style =
    styleCandidate === "bezier" ||
    styleCandidate === "straight" ||
    styleCandidate === "step" ||
    styleCandidate === "smoothstep"
      ? styleCandidate
      : edgeStyleFromType(edge.type);
  const dashRaw = edge.style?.strokeDasharray;
  const patternFromStroke = dashRaw === "7 6" ? "dashed" : dashRaw === "1 10" ? "dotted" : "solid";
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

export function edgeDashFromPattern(pattern: EdgePattern): string | undefined {
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

export function edgeClassName(pattern: EdgePattern, animated: boolean): string {
  const base = edgeClassFromPattern(pattern) ?? "";
  return `${base}${animated ? "" : " mindmap-edge-no-anim"}`.trim();
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function edgeAnimatedFromPattern(pattern: EdgePattern): boolean {
  return pattern !== "solid";
}
