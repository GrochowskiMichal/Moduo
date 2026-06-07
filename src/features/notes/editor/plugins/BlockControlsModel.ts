import {
  BLOCK_REGISTRY,
  type BlockRegistryEntry,
  type DraggableUnit,
  getRegistryEntry,
} from "./BlockRegistry";

export type DropPlacement = "before" | "after";

export type DropDecision = {
  allowed: boolean;
  convertToListItem?: boolean;
  reason?:
    | "empty-selection"
    | "missing-target"
    | "target-inside-selection"
    | "not-contiguous"
    | "different-parent"
    | "invalid-zone"
    | "self-drop"
    | "cross-parent"
    | "not-list"
    | "non-list-to-list";
};

export const BLOCK_ACTION_COMMAND_IDS: string[] = [
  "paragraph",
  "h1",
  "h2",
  "h3",
  "bullet",
  "number",
  "todo",
  "quote",
  "code",
  "toggle",
];

// ─── Core helpers ─────────────────────────────────────────────────────────────

export function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function areContiguousSiblings(selectedKeys: string[], siblingOrder: string[]): boolean {
  const keys = uniqueKeys(selectedKeys);
  if (keys.length === 0) return false;

  const indexes = keys
    .map((key) => siblingOrder.indexOf(key))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  if (indexes.length !== keys.length) return false;

  for (let i = 1; i < indexes.length; i += 1) {
    if (indexes[i]! !== indexes[i - 1]! + 1) return false;
  }
  return true;
}

export function resolveDropPlacement(pointerY: number, targetTop: number, targetHeight: number): DropPlacement {
  return pointerY < targetTop + targetHeight / 2 ? "before" : "after";
}

export function decideSiblingDrop(options: {
  selectedKeys: string[];
  targetKey: string | null;
  siblingOrder: string[];
  sameParent: boolean;
}): DropDecision {
  const selectedKeys = uniqueKeys(options.selectedKeys);
  if (selectedKeys.length === 0) return { allowed: false, reason: "empty-selection" };
  if (!options.targetKey) return { allowed: false, reason: "missing-target" };
  if (selectedKeys.includes(options.targetKey)) return { allowed: false, reason: "target-inside-selection" };
  if (!options.sameParent) return { allowed: false, reason: "different-parent" };
  if (!areContiguousSiblings(selectedKeys, options.siblingOrder)) {
    return { allowed: false, reason: "not-contiguous" };
  }
  return { allowed: true };
}

export function shouldExposeSlashLikeControls(nodeType: string): boolean {
  return nodeType !== "code" && nodeType !== "tablecell" && nodeType !== "tablerow";
}

// ─── PRD-aware drop zone validation ───────────────────────────────────────────

/**
 * PRD valid drop zones (section 05):
 * - Top-level blocks: between any top-level blocks; between open toggle children
 * - List items: between same-type siblings; top-level (converts to paragraph)
 * - Toggle subtree: between top-level blocks only
 * - Table: between top-level blocks only
 * - Code: between top-level blocks
 * - Inside code/table/collapsed toggle = always invalid
 */
export function validateDropZone(validation: {
  draggedType: string;
  targetType: string;
  targetParentType: string | null;
  isTopLevel: boolean;
  /** Key of the dragged node's direct parent (for cross-toggle detection). */
  sourceParentKey?: string | null;
  /** Lexical type of the dragged node's direct parent. */
  sourceParentType?: string | null;
  /** Key of the target node's direct parent (for cross-toggle detection). */
  targetParentKey?: string | null;
  /** Draggable unit class for the dragged block. */
  draggedUnit?: DraggableUnit;
  /** Whether the toggle that contains the target is currently open.
   *  Only relevant when targetParentType === "toggle". */
  targetToggleOpen?: boolean;
}): { valid: boolean; convertToParagraph?: boolean; convertToListItem?: boolean; reason?: DropDecision["reason"] } {
  const { draggedType, targetType, isTopLevel } = validation;

  // Never allow drops INTO code, table cells, or table rows
  if (targetType === "code" || targetType === "tablecell" || targetType === "tablerow") {
    return { valid: false, reason: "invalid-zone" };
  }

  // Toggle/table/code dragged blocks can only be dropped at top-level
  if (["toggle", "table", "code"].includes(draggedType) && !isTopLevel) {
    return { valid: false, reason: "invalid-zone" };
  }

  // Cannot drop into a collapsed toggle body
  if (validation.targetParentType === "toggle" && validation.targetToggleOpen === false) {
    return { valid: false, reason: "invalid-zone" };
  }

  // Cross-toggle child move: a block that lives inside a toggle can only be
  // reordered within the same toggle, or moved to top-level. Dropping it into
  // a different toggle's body is rejected.
  if (validation.sourceParentType === "toggle") {
    if (isTopLevel) {
      // child → top-level is allowed
    } else if (
      validation.targetParentType === "toggle" &&
      validation.targetParentKey != null &&
      validation.sourceParentKey != null &&
      validation.targetParentKey === validation.sourceParentKey
    ) {
      // same-toggle reorder: allowed — fall through to final `valid: true`
    } else if (validation.targetParentType === "toggle") {
      // different toggle: reject
      return { valid: false, reason: "cross-parent" };
    }
  }

  // List item dropped to top-level: convert to paragraph
  if (isListItemType(draggedType) && isTopLevel) {
    return { valid: true, convertToParagraph: true };
  }

  // Dropping a non-list-item into a list: only convert if the dragged type
  // supports becoming a list item per the registry. Otherwise reject the drop.
  if (!isListItemType(draggedType) && !isTopLevel && validation.targetParentType === "list") {
    const entry = BLOCK_REGISTRY[draggedType];
    const convertibleToEntry = entry?.convertibleTo ?? [];
    const canBecomeListItem = convertibleToEntry.some((cmd) =>
      ["bullet", "number", "todo"].includes(cmd),
    );
    if (!canBecomeListItem) {
      return { valid: false, reason: "non-list-to-list" };
    }
    return { valid: true, convertToListItem: true };
  }

  return { valid: true };
}

export function getDraggableUnit(lexicalType: string): DraggableUnit {
  const entry = getRegistryEntry(lexicalType);
  return entry?.draggableUnit ?? "none";
}

export function getBlockRegistryEntry(lexicalType: string): BlockRegistryEntry | undefined {
  return getRegistryEntry(lexicalType);
}

export function shouldConvertListDragToParagraph(
  draggedType: string,
  isDroppingToTopLevel: boolean,
): boolean {
  return isListItemType(draggedType) && isDroppingToTopLevel;
}

export function isListType(type: string): boolean {
  return isListItemType(type) || type === "bullet" || type === "number" || type === "todo";
}

export function isListItemType(type: string): boolean {
  return type === "listitem" || type === "listitem-bullet" || type === "listitem-number" || type === "listitem-todo";
}
