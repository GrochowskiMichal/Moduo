import type { Edge, Node } from "@xyflow/react";

export const TEMPLATE_CHILD_SEPARATOR = "::";
export const TEMPLATE_EDGE_PREFIX = "template-edge:";
export const PESTEL_NOTE_COUNT = 6;

export type BrainstormGraphNodeData = {
  variant: "root" | "section" | "pestel-letter" | "pestel-area" | "pestel-note";
  label: string;
  icon?: string;
  templateName?: string;
  description?: string;
  sections?: string[];
  color?: string;
  textColor?: string;
  backgroundColor?: string;
};

export type BrainstormGraphNode = Node<BrainstormGraphNodeData, "brainstorm">;

export type TemplateVisualBundle = {
  nodes: BrainstormGraphNode[];
  edges: Edge[];
};

export function isTemplateChildNode(nodeId: string) {
  return nodeId.includes(TEMPLATE_CHILD_SEPARATOR);
}

export function toRootNodeId(nodeId: string) {
  return nodeId.split(TEMPLATE_CHILD_SEPARATOR)[0] ?? nodeId;
}

