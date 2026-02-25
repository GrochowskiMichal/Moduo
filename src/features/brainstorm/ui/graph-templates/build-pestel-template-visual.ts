import type { BrainstormEntry } from "../../types";
import type { BrainstormTemplate } from "../../templates";
import { PESTEL_NOTE_COUNT, TEMPLATE_CHILD_SEPARATOR, type BrainstormGraphNode, type TemplateVisualBundle } from "./types";

function defaultEntryPosition(index: number) {
  return {
    x: 130 + (index % 3) * 320,
    y: 120 + Math.floor(index / 3) * 220,
  };
}

function truncateText(value: string, max: number) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

const PESTEL_FACTORS = [
  { key: "political", letter: "P", title: "Political", tile: "#f4c430", tileText: "#2a2100", panel: "#efe6cc", badge: "#f2be3f", note: "#f6d779" },
  { key: "economic", letter: "E", title: "Economic", tile: "#1cad5a", tileText: "#f4fff8", panel: "#dceee2", badge: "#79d2a2", note: "#8ad8ab" },
  { key: "social", letter: "S", title: "Social", tile: "#2490e5", tileText: "#f4fbff", panel: "#dbeaf7", badge: "#5ab8ea", note: "#74c9ec" },
  { key: "technological", letter: "T", title: "Technological", tile: "#8547e5", tileText: "#f6f1ff", panel: "#e6def2", badge: "#a57ee8", note: "#b493e9" },
  { key: "environmental", letter: "E", title: "Environmental", tile: "#f74b1f", tileText: "#fff7f4", panel: "#f2e0da", badge: "#f26e53", note: "#f1a093" },
  { key: "legal", letter: "L", title: "Legal", tile: "#f7a62c", tileText: "#2a1800", panel: "#f2e8d5", badge: "#efbd69", note: "#f4cc8f" },
] as const;

export function buildPestelTemplateVisual(
  entry: BrainstormEntry,
  index: number,
  template: BrainstormTemplate | undefined
): TemplateVisualBundle {
  const root = entry.position ?? defaultEntryPosition(index);
  const laneWidth = 240;
  const laneGap = 22;
  const startX = root.x;
  const lettersY = root.y + 12;
  const boardsY = root.y + 162;
  const templateName = template?.name ?? "PESTEL Analysis";
  const templateDescription = template?.description ?? "Macro-environmental scan";
  const templateIcon = template?.icon ?? "🌍";
  const templateColor = template?.color ?? "#8b5cf6";

  const contextNode: BrainstormGraphNode = {
    id: `${entry.id}${TEMPLATE_CHILD_SEPARATOR}pestel:context`,
    type: "brainstorm",
    draggable: false,
    selectable: true,
    position: { x: startX, y: root.y - 84 },
    data: {
      variant: "section",
      label: entry.name,
      icon: templateIcon,
      templateName,
      description: entry.fields.context ?? templateDescription,
      color: templateColor,
      sections: [],
    },
  };

  const insightsNode: BrainstormGraphNode = {
    id: `${entry.id}${TEMPLATE_CHILD_SEPARATOR}pestel:insights`,
    type: "brainstorm",
    draggable: false,
    selectable: true,
    position: { x: startX + PESTEL_FACTORS.length * (laneWidth + laneGap) - laneWidth, y: root.y - 84 },
    data: {
      variant: "section",
      label: "Key Insights",
      icon: templateIcon,
      templateName,
      description: entry.fields.insights ?? "Most impactful factors and recommended actions...",
      color: templateColor,
      sections: [],
    },
  };

  const nodes = PESTEL_FACTORS.flatMap((factor, factorIndex) => {
    const x = startX + factorIndex * (laneWidth + laneGap);
    const fieldDescription = entry.fields[factor.key] ?? "Add factor insights";
    const letterNode: BrainstormGraphNode = {
      id: `${entry.id}${TEMPLATE_CHILD_SEPARATOR}pestel:letter:${factor.key}`,
      type: "brainstorm",
      draggable: false,
      selectable: true,
      position: { x, y: lettersY },
      data: {
        variant: "pestel-letter",
        label: factor.letter,
        backgroundColor: factor.tile,
        textColor: factor.tileText,
      },
    };
    const areaNode: BrainstormGraphNode = {
      id: `${entry.id}${TEMPLATE_CHILD_SEPARATOR}pestel:area:${factor.key}`,
      type: "brainstorm",
      draggable: false,
      selectable: true,
      position: { x, y: boardsY },
      data: {
        variant: "pestel-area",
        label: factor.title,
        backgroundColor: factor.panel,
        color: templateColor,
        textColor: factor.tileText,
        icon: templateIcon,
        templateName,
        description: templateDescription,
      },
    };
    const noteNodes: BrainstormGraphNode[] = Array.from({ length: PESTEL_NOTE_COUNT }, (_, noteIndex) => {
      const noteX = x + 12 + (noteIndex % 2) * 112;
      const noteY = boardsY + 58 + Math.floor(noteIndex / 2) * 82;
      return {
        id: `${entry.id}${TEMPLATE_CHILD_SEPARATOR}pestel:note:${factor.key}:${noteIndex}`,
        type: "brainstorm",
        draggable: false,
        selectable: true,
        position: { x: noteX, y: noteY },
        data: {
          variant: "pestel-note",
          label: "",
          description: truncateText(fieldDescription, 44),
          backgroundColor: factor.note,
        },
      };
    });
    return [letterNode, areaNode, ...noteNodes];
  });

  return { nodes: [contextNode, insightsNode, ...nodes], edges: [] };
}
