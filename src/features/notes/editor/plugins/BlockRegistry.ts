import type { LexicalNode } from "lexical";

// ─── PRD-derived block types ──────────────────────────────────────────────────
// These map 1:1 to the PRD's block type registry rows.
// "listitem-bullet" / "listitem-number" / "listitem-todo" model the PRD's
// distinction between bullet, number, and todo list items.

export type BlockType =
  | "paragraph"
  | "heading"
  | "listitem-bullet"
  | "listitem-number"
  | "listitem-todo"
  | "quote"
  | "code"
  | "toggle"
  | "divider"
  | "table";

export type ListBox = "bullet" | "number" | "check";

export type DraggableUnit = "self" | "list-item" | "toggle-subtree" | "whole-table" | "none";

export type ConvertibleTo = string[];

export type BlockMenuActions = {
  turnInto: boolean;
  duplicate: boolean;
  copyText: boolean;
  delete: boolean;
  moveUp: boolean;
  moveDown: boolean;
  insertAbove: boolean;
  insertBelow: boolean;
};

export type BlockRegistryEntry = {
  type: BlockType;
  listBox?: ListBox;
  headingTag?: string;
  draggableUnit: DraggableUnit;
  convertibleTo: ConvertibleTo;
  menuActions: BlockMenuActions;
};

// ─── Menu action presets ──────────────────────────────────────────────────────

function fullMenu(): BlockMenuActions {
  return {
    turnInto: true,
    duplicate: true,
    copyText: true,
    delete: true,
    moveUp: true,
    moveDown: true,
    insertAbove: true,
    insertBelow: true,
  };
}

function noTurnIntoMenu(): BlockMenuActions {
  return {
    turnInto: false,
    duplicate: true,
    copyText: true,
    delete: true,
    moveUp: true,
    moveDown: true,
    insertAbove: true,
    insertBelow: true,
  };
}

// ─── PRD-authoritative block registry ─────────────────────────────────────────
// Each row corresponds to the PRD's block type registry table (section 03).
// Convertible types use slash-command IDs (paragraph, h1, h2, h3, bullet,
// number, todo, quote, code, toggle).

export const BLOCK_REGISTRY: Record<string, BlockRegistryEntry> = {
  paragraph: {
    type: "paragraph",
    draggableUnit: "self",
    convertibleTo: ["h1", "h2", "h3", "bullet", "number", "todo", "quote", "code", "toggle"],
    menuActions: fullMenu(),
  },
  heading: {
    type: "heading",
    draggableUnit: "self",
    convertibleTo: ["paragraph", "h1", "h2", "h3", "bullet", "number", "quote"],
    menuActions: fullMenu(),
  },
  h1: {
    type: "heading",
    headingTag: "h1",
    draggableUnit: "self",
    convertibleTo: ["paragraph", "h2", "h3", "bullet", "number", "quote"],
    menuActions: fullMenu(),
  },
  h2: {
    type: "heading",
    headingTag: "h2",
    draggableUnit: "self",
    convertibleTo: ["paragraph", "h1", "h3", "bullet", "number", "quote"],
    menuActions: fullMenu(),
  },
  h3: {
    type: "heading",
    headingTag: "h3",
    draggableUnit: "self",
    convertibleTo: ["paragraph", "h1", "h2", "bullet", "number", "quote"],
    menuActions: fullMenu(),
  },
  "listitem-bullet": {
    type: "listitem-bullet",
    listBox: "bullet",
    draggableUnit: "list-item",
    convertibleTo: ["paragraph", "number", "todo", "quote"],
    menuActions: fullMenu(),
  },
  "listitem-number": {
    type: "listitem-number",
    listBox: "number",
    draggableUnit: "list-item",
    convertibleTo: ["paragraph", "bullet", "todo", "quote"],
    menuActions: fullMenu(),
  },
  "listitem-todo": {
    type: "listitem-todo",
    listBox: "check",
    draggableUnit: "list-item",
    convertibleTo: ["paragraph", "bullet", "number", "quote"],
    menuActions: fullMenu(),
  },
  quote: {
    type: "quote",
    draggableUnit: "self",
    convertibleTo: ["paragraph", "bullet", "number"],
    menuActions: fullMenu(),
  },
  code: {
    type: "code",
    draggableUnit: "self",
    convertibleTo: ["paragraph"],
    menuActions: noTurnIntoMenu(),
  },
  toggle: {
    type: "toggle",
    draggableUnit: "toggle-subtree",
    convertibleTo: ["paragraph", "h1", "h2", "h3"],
    menuActions: fullMenu(),
  },
  divider: {
    type: "divider",
    draggableUnit: "self",
    convertibleTo: [],
    menuActions: noTurnIntoMenu(),
  },
  table: {
    type: "table",
    draggableUnit: "whole-table",
    convertibleTo: [],
    menuActions: noTurnIntoMenu(),
  },
};

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Resolve a Lexical node type + derived state to a registry key.
 * For list items, inspects the parent list's listType to distinguish
 * bullet vs number vs todo. For headings, uses the tag.
 */
export function resolveRegistryKey(
  lexicalType: string,
  extra?: { listType?: ListBox; headingTag?: string },
): string {
  if (lexicalType === "listitem") {
    if (extra?.listType === "number") return "listitem-number";
    if (extra?.listType === "check") return "listitem-todo";
    return "listitem-bullet";
  }
  if (lexicalType === "heading") {
    if (extra?.headingTag && ["h1", "h2", "h3"].includes(extra.headingTag)) {
      return extra.headingTag;
    }
  }
  return lexicalType;
}

export function getListItemBox(node: LexicalNode): ListBox | undefined {
  const current = node;
  const parent = current.getParent();
  if (!parent) return undefined;
  if (parent.getType() !== "list") return undefined;
  const list = parent as { getListType?: () => string } & LexicalNode;
  const listType = typeof list.getListType === "function" ? list.getListType() : undefined;
  if (listType === "number") return "number";
  if (listType === "check") return "check";
  return "bullet";
}

export function getRegistryEntryForNode(
  node: LexicalNode | null,
): BlockRegistryEntry | undefined {
  if (!node) return undefined;
  const lexicalType = node.getType();
  let extra: { listType?: ListBox; headingTag?: string } | undefined;
  if (lexicalType === "listitem" || lexicalType === "listitem-bullet" || lexicalType === "listitem-number" || lexicalType === "listitem-todo") {
    const box = getListItemBox(node);
    if (box) extra = { listType: box };
  }
  if (lexicalType === "heading") {
    const heading = node as { getTag?: () => string } & LexicalNode;
    const tag = typeof heading.getTag === "function" ? heading.getTag() : undefined;
    if (tag) extra = { ...extra, headingTag: tag };
  }
  return getRegistryEntryForLexicalType(lexicalType, extra);
}

export function getRegistryEntryForLexicalType(
  lexicalType: string,
  extra?: { listType?: ListBox; headingTag?: string },
): BlockRegistryEntry | undefined {
  const key = resolveRegistryKey(lexicalType, extra);
  return BLOCK_REGISTRY[key];
}

export function getRegistryEntry(lexicalType: string): BlockRegistryEntry | undefined {
  if (lexicalType === "listitem") return BLOCK_REGISTRY["listitem-bullet"];
  return BLOCK_REGISTRY[lexicalType];
}

export function isDraggable(lexicalType: string): boolean {
  const entry = getRegistryEntry(lexicalType);
  return entry ? entry.draggableUnit !== "none" : false;
}

export function canConvert(lexicalType: string): boolean {
  const entry = getRegistryEntry(lexicalType);
  return entry ? entry.convertibleTo.length > 0 : false;
}

export function getConvertibleCommands(
  lexicalType: string,
  allCommands: { id: string; [k: string]: unknown }[],
): { id: string; [k: string]: unknown }[] {
  const entry = getRegistryEntry(lexicalType);
  if (!entry || entry.convertibleTo.length === 0) return [];
  return allCommands.filter((cmd) => entry.convertibleTo.includes(cmd.id));
}

export function getMenuActions(lexicalType: string): BlockMenuActions {
  const entry = getRegistryEntry(lexicalType);
  if (!entry) return noTurnIntoMenu();
  return entry.menuActions;
}

// ─── Code block ancestor check (shared by gutter + slash picker) ──────────────

export function isInsideCodeBlock(node: LexicalNode | null): boolean {
  let current = node;
  while (current) {
    const parent = current.getParent();
    if (!parent) break;
    if (parent.getType() === "code") return true;
    current = parent;
  }
  return false;
}

/**
 * Distinguish a hover on the code block's outer shell from a pointer target
 * inside the code text. Returns true when the target IS the code node's
 * element (the shell) — not a descendant text span or character cell.
 *
 * Used by the block controls plugin to decide whether to expose the gutter
 * handle on a code block: the handle is only meant to appear on the shell,
 * never over the code text, since code blocks own their internal cursor.
 */
export function isCodeBlockShellDomTarget(
  target: EventTarget | Node | null,
  shellElement: HTMLElement | null,
): boolean {
  if (!target || !shellElement) return false;
  return target === shellElement;
}
