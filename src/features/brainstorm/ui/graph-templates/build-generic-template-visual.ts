import type { Edge } from "@xyflow/react";
import type { BrainstormEntry } from "../../types";
import type { BrainstormTemplate } from "../../templates";
import {
  TEMPLATE_CHILD_SEPARATOR,
  TEMPLATE_EDGE_PREFIX,
  type BrainstormGraphNode,
  type TemplateVisualBundle,
} from "./types";

function defaultEntryPosition(index: number) {
  return {
    x: 130 + (index % 3) * 320,
    y: 120 + Math.floor(index / 3) * 220,
  };
}

function templateChildPosition(root: { x: number; y: number }, index: number, total: number) {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1);
  const radius = total > 6 ? 300 : 250;
  return {
    x: root.x + Math.cos(angle) * radius,
    y: root.y + Math.sin(angle) * (radius * 0.7),
  };
}

export function buildGenericTemplateVisual(
  entry: BrainstormEntry,
  index: number,
  template: BrainstormTemplate | undefined
): TemplateVisualBundle {
  const root = entry.position ?? defaultEntryPosition(index);
  const rootNode: BrainstormGraphNode = {
    id: entry.id,
    type: "brainstorm",
    position: root,
    data: {
      variant: "root",
      label: entry.name,
      icon: template?.icon ?? "🧩",
      templateName: template?.name ?? "Template",
      description: template?.description ?? "Template structure",
      sections: (template?.fields ?? []).map((field) => field.label),
      color: template?.color ?? "#6366f1",
    },
  };
  const fields = template?.fields ?? [];
  const sectionNodes: BrainstormGraphNode[] = fields.map((field, fieldIndex) => ({
    id: `${entry.id}${TEMPLATE_CHILD_SEPARATOR}${field.key}`,
    type: "brainstorm",
    draggable: false,
    selectable: true,
    position: templateChildPosition(root, fieldIndex, fields.length),
    data: {
      variant: "section",
      label: field.label,
      icon: template?.icon ?? "🧩",
      templateName: template?.name ?? "Template",
      description: field.placeholder,
      sections: [],
      color: template?.color ?? "#6366f1",
    },
  }));
  const sectionEdges: Edge[] = fields.map((field) => ({
    id: `${TEMPLATE_EDGE_PREFIX}${entry.id}:${field.key}`,
    source: entry.id,
    target: `${entry.id}${TEMPLATE_CHILD_SEPARATOR}${field.key}`,
    type: "smoothstep",
    animated: false,
    style: { stroke: "#3f4658", strokeWidth: 1.5 },
    selectable: false,
  }));
  return { nodes: [rootNode, ...sectionNodes], edges: sectionEdges };
}

