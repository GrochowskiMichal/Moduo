import type { LayoutMode, MindmapEdge, MindmapNode } from "../types";

/** Simple hierarchical auto-layout engine supporting several modes. */

type LayoutResult = {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
};

type LayoutNodeRef = {
  id: string;
  children: LayoutNodeRef[];
  width: number;
  height: number;
};

const NODE_WIDTH = 240;
const NODE_HEIGHT = 80;
const H_GAP = 80;
const V_GAP = 60;

function buildTree(nodes: MindmapNode[], edges: MindmapEdge[]): LayoutNodeRef[] {
  const childrenMap = new Map<string, string[]>();
  const childSet = new Set<string>();

  for (const edge of edges) {
    if (!childrenMap.has(edge.source)) childrenMap.set(edge.source, []);
    childrenMap.get(edge.source)!.push(edge.target);
    childSet.add(edge.target);
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function buildRef(id: string): LayoutNodeRef {
    const children = (childrenMap.get(id) || [])
      .filter((childId) => nodeMap.has(childId))
      .map(buildRef);
    return { id, children, width: NODE_WIDTH, height: NODE_HEIGHT };
  }

  // Root nodes = nodes not appearing as targets
  const roots = nodes.filter((n) => !childSet.has(n.id));
  if (roots.length === 0 && nodes.length > 0) return [buildRef(nodes[0]!.id)];
  return roots.map((r) => buildRef(r.id));
}

function computeSubtreeHeight(ref: LayoutNodeRef): number {
  if (ref.children.length === 0) return ref.height;
  const total = ref.children.reduce((sum, c) => sum + computeSubtreeHeight(c), 0);
  return total + (ref.children.length - 1) * V_GAP;
}

function computeSubtreeWidth(ref: LayoutNodeRef): number {
  if (ref.children.length === 0) return ref.width;
  const total = ref.children.reduce((sum, c) => sum + computeSubtreeWidth(c), 0);
  return total + (ref.children.length - 1) * H_GAP;
}

/* ── Horizontal tree (classic mindmap / XMind style) ── */
function layoutHorizontal(
  ref: LayoutNodeRef,
  x: number,
  y: number,
  positions: Map<string, { x: number; y: number }>,
  depth: number,
) {
  positions.set(ref.id, { x, y });

  if (ref.children.length === 0) return;

  const subtreeH = computeSubtreeHeight(ref);
  let childY = y - subtreeH / 2 + ref.height / 2;
  const childX = x + ref.width + H_GAP;

  for (const child of ref.children) {
    const childH = computeSubtreeHeight(child);
    const cy = childY + childH / 2 - child.height / 2;
    layoutHorizontal(child, childX, cy, positions, depth + 1);
    childY += childH + V_GAP;
  }
}

/* ── Vertical tree ── */
function layoutVertical(
  ref: LayoutNodeRef,
  x: number,
  y: number,
  positions: Map<string, { x: number; y: number }>,
  depth: number,
) {
  positions.set(ref.id, { x, y });

  if (ref.children.length === 0) return;

  const subtreeW = computeSubtreeWidth(ref);
  let childX = x - subtreeW / 2 + ref.width / 2;
  const childY = y + ref.height + V_GAP;

  for (const child of ref.children) {
    const childW = computeSubtreeWidth(child);
    const cx = childX + childW / 2 - child.width / 2;
    layoutVertical(child, cx, childY, positions, depth + 1);
    childX += childW + H_GAP;
  }
}

/* ── Mindmap – root in center, children fan out left & right ── */
function layoutMindmap(roots: LayoutNodeRef[], positions: Map<string, { x: number; y: number }>) {
  for (const root of roots) {
    positions.set(root.id, { x: 0, y: 0 });
    const leftChildren = root.children.filter((_, i) => i % 2 === 0);
    const rightChildren = root.children.filter((_, i) => i % 2 === 1);

    // Right side
    if (rightChildren.length > 0) {
      const totalH =
        rightChildren.reduce((sum, c) => sum + computeSubtreeHeight(c), 0) +
        (rightChildren.length - 1) * V_GAP;
      let childY = -totalH / 2 + NODE_HEIGHT / 2;
      for (const child of rightChildren) {
        const h = computeSubtreeHeight(child);
        layoutHorizontal(child, NODE_WIDTH + H_GAP, childY + h / 2 - NODE_HEIGHT / 2, positions, 1);
        childY += h + V_GAP;
      }
    }

    // Left side (mirror)
    if (leftChildren.length > 0) {
      const totalH =
        leftChildren.reduce((sum, c) => sum + computeSubtreeHeight(c), 0) +
        (leftChildren.length - 1) * V_GAP;
      let childY = -totalH / 2 + NODE_HEIGHT / 2;
      for (const child of leftChildren) {
        const h = computeSubtreeHeight(child);
        layoutHorizontalMirror(child, -H_GAP, childY + h / 2 - NODE_HEIGHT / 2, positions, 1);
        childY += h + V_GAP;
      }
    }
  }
}

function layoutHorizontalMirror(
  ref: LayoutNodeRef,
  x: number,
  y: number,
  positions: Map<string, { x: number; y: number }>,
  depth: number,
) {
  positions.set(ref.id, { x: x - ref.width, y });

  if (ref.children.length === 0) return;

  const subtreeH = computeSubtreeHeight(ref);
  let childY = y - subtreeH / 2 + ref.height / 2;
  const childX = x - ref.width - H_GAP;

  for (const child of ref.children) {
    const childH = computeSubtreeHeight(child);
    const cy = childY + childH / 2 - child.height / 2;
    layoutHorizontalMirror(child, childX, cy, positions, depth + 1);
    childY += childH + V_GAP;
  }
}

/* ── Org chart (vertical center-aligned) ── */
function layoutOrgChart(roots: LayoutNodeRef[], positions: Map<string, { x: number; y: number }>) {
  let startX = 0;
  for (const root of roots) {
    layoutVertical(root, startX, 0, positions, 0);
    startX += computeSubtreeWidth(root) + H_GAP * 2;
  }
}

/* ── Radial layout ── */
function layoutRadial(roots: LayoutNodeRef[], positions: Map<string, { x: number; y: number }>) {
  for (const root of roots) {
    positions.set(root.id, { x: 0, y: 0 });
    const children = root.children;
    if (children.length === 0) continue;

    const radius = 280;
    const angleStep = (2 * Math.PI) / children.length;

    children.forEach((child, i) => {
      const angle = angleStep * i - Math.PI / 2;
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;
      spreadRadial(child, cx, cy, angle, radius * 0.8, positions, 2);
    });
  }
}

function spreadRadial(
  ref: LayoutNodeRef,
  x: number,
  y: number,
  parentAngle: number,
  radius: number,
  positions: Map<string, { x: number; y: number }>,
  depth: number,
) {
  positions.set(ref.id, { x, y });
  if (ref.children.length === 0 || depth > 6) return;

  const spread = Math.PI * 0.6;
  const step = ref.children.length > 1 ? spread / (ref.children.length - 1) : 0;
  const startAngle = parentAngle - spread / 2;

  ref.children.forEach((child, i) => {
    const angle = startAngle + step * i;
    const cx = x + Math.cos(angle) * radius;
    const cy = y + Math.sin(angle) * radius;
    spreadRadial(child, cx, cy, angle, radius * 0.75, positions, depth + 1);
  });
}

/* ═══════════════ Main entry ═══════════════ */

export function autoLayout(
  nodes: MindmapNode[],
  edges: MindmapEdge[],
  mode: LayoutMode,
): LayoutResult {
  if (nodes.length === 0) return { nodes, edges };
  if (mode === "free") return { nodes, edges };

  const roots = buildTree(nodes, edges);
  const positions = new Map<string, { x: number; y: number }>();

  switch (mode) {
    case "mindmap":
      layoutMindmap(roots, positions);
      break;
    case "tree-horizontal":
      for (const root of roots) {
        layoutHorizontal(root, 0, 0, positions, 0);
      }
      break;
    case "tree-vertical":
      layoutOrgChart(roots, positions);
      break;
    case "radial":
      layoutRadial(roots, positions);
      break;
    case "org-chart":
      layoutOrgChart(roots, positions);
      break;
    default:
      layoutMindmap(roots, positions);
  }

  // Compute depth for each node
  const depthMap = new Map<string, number>();
  function computeDepth(ref: LayoutNodeRef, d: number) {
    depthMap.set(ref.id, d);
    for (const child of ref.children) computeDepth(child, d + 1);
  }
  for (const root of roots) computeDepth(root, 0);

  const updatedNodes = nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) return node;
    return {
      ...node,
      position: pos,
      data: { ...node.data, depth: depthMap.get(node.id) ?? node.data.depth },
    };
  });

  return { nodes: updatedNodes, edges };
}
