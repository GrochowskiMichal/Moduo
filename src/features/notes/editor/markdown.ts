/**
 * Markdown at every door (Wave-3 NO-4, AC11): the Notes transformer set for
 * @lexical/markdown plus the paste heuristic and a selection→markdown walker
 * for copy. Moduo entities serialize as `[label](moduo://type/id)` — lossless
 * enough to re-import (chips inline, page-rows as a standalone line).
 *
 * NOTE (vitest gotcha): everything here is imported by tests — keep VALUE
 * imports relative, never `@/`.
 */

import {
  CHECK_LIST,
  ELEMENT_TRANSFORMERS,
  type ElementTransformer,
  MULTILINE_ELEMENT_TRANSFORMERS,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";
import type { ElementNode, LexicalNode } from "lexical";
import { $createParagraphNode, $isTextNode } from "lexical";
import { $createEntityRefNode, EntityRefNode } from "../../spine/editor/entity-ref-node";
import { $createEmbedNode, $isEmbedNode, EmbedNode } from "./nodes/EmbedNode";
import { $createPageRowNode, $isPageRowNode, PageRowNode } from "./nodes/page-row-node";
import { $createTaskLineNode, $isTaskLineNode, TaskLineNode } from "./nodes/task-line-node";

const MODUO_URI = /moduo:\/\/([a-z][a-z-]*)\/([A-Za-z0-9-]+)/;

/** The task-line stable-id convention: `- [ ] Title <!-- moduo:task:<id> -->`
 * (DESIGN_BRIEF §3f — readable md, lossless enough to re-import). */
const TASK_ID_COMMENT = /\s*<!--\s*moduo:task:([A-Za-z0-9-]+)\s*-->\s*$/;

/** `- [x] Title <!-- moduo:task:<id> -->` ⇄ a task line. Must sit BEFORE
 * CHECK_LIST in the set — without the id comment the line is (and stays) a
 * humble checkbox; with it, the task line wins the match. A PENDING line
 * (no id yet) exports as a plain checkbox — honest, nothing to rehydrate. */
export const TASK_LINE_TRANSFORMER: ElementTransformer = {
  dependencies: [TaskLineNode],
  export: (node, traverseChildren) => {
    if (!$isTaskLineNode(node)) return null;
    const taskId = node.getTaskId();
    const box = node.getDone() ? "x" : " ";
    const title = traverseChildren(node);
    return taskId === null
      ? `- [${box}] ${title}`
      : `- [${box}] ${title} <!-- moduo:task:${taskId} -->`;
  },
  // Consume only the checkbox prefix (the importer inline-parses the rest);
  // the lookahead gates the match on the trailing id comment.
  regExp: /^- \[( |x|X)\] (?=.*<!--\s*moduo:task:[A-Za-z0-9-]+\s*-->\s*$)/,
  replace: (parentNode, children, match) => {
    const line = $createTaskLineNode(null, match[1] !== " ");
    children.forEach((child) => {
      line.append(child);
    });
    // The id rides the last text run — extract it, strip the comment.
    const last = line.getLastChild();
    if ($isTextNode(last)) {
      const text = last.getTextContent();
      const idMatch = text.match(TASK_ID_COMMENT);
      if (idMatch) {
        line.setTaskId(idMatch[1]!);
        const stripped = text.replace(TASK_ID_COMMENT, "");
        if (stripped === "") last.remove();
        else last.setTextContent(stripped);
      }
    }
    parentNode.replace(line);
  },
  type: "element",
};

/** `[title](moduo://note/<id>)` alone on a line ⇄ a page-row block. */
export const PAGE_ROW_TRANSFORMER: ElementTransformer = {
  dependencies: [PageRowNode],
  export: (node) => {
    if (!$isPageRowNode(node)) return null;
    const label = node.getLabel() || "Untitled";
    return `[${label.replace(/\]/g, "")}](moduo://note/${node.getNoteId()})`;
  },
  regExp: /^\[([^\]]+)\]\(moduo:\/\/note\/([A-Za-z0-9-]+)\)\s*$/,
  replace: (parentNode, _children, match) => {
    parentNode.replace($createPageRowNode(match[2]!, match[1]!));
  },
  type: "element",
};

/** `[label](moduo://mindmap/<id>)` alone on a line ⇄ the mindmap embed. */
export const EMBED_TRANSFORMER: ElementTransformer = {
  dependencies: [EmbedNode],
  export: (node) => {
    if (!$isEmbedNode(node)) return null;
    const kind = (node as EmbedNode).__kind;
    if (kind !== "mindmap") return ""; // legacy task embeds render null — drop
    return `[Mindmap](moduo://mindmap/${(node as EmbedNode).__itemId})`;
  },
  regExp: /^\[[^\]]*\]\(moduo:\/\/mindmap\/([A-Za-z0-9-]+)\)\s*$/,
  replace: (parentNode, _children, match) => {
    parentNode.replace($createEmbedNode("mindmap", match[1]!));
  },
  type: "element",
};

/** `---` ⇄ divider (0.40 ships no HR transformer of its own). */
export const HR_TRANSFORMER: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? "---" : null),
  regExp: /^(?:---|\*\*\*|___)\s?$/,
  replace: (parentNode, children, _match, isImport) => {
    const line = $createHorizontalRuleNode();
    if (isImport) {
      parentNode.replace(line);
      return;
    }
    // Live typing (MarkdownShortcutPlugin). `children` are the inline nodes
    // that followed `---` on the same line — move them into a fresh paragraph
    // so a chip/text after the divider is never destroyed (validator A3). Also
    // keep a caret paragraph when the divider lands at the very end of the doc.
    const rest = $createParagraphNode();
    for (const child of children) rest.append(child);
    const keepRest = rest.getChildrenSize() > 0 || parentNode.getNextSibling() == null;
    parentNode.replace(line);
    if (keepRest) {
      line.insertAfter(rest);
      rest.selectStart();
    } else {
      line.selectNext();
    }
  },
  type: "element",
};

/** Inline `[label](moduo://type/id)` ⇄ an entity-ref chip (any type — a
 * note-link INSIDE a sentence stays a chip; only a standalone line becomes a
 * page-row, the element transformer above wins that case). */
export const ENTITY_REF_TRANSFORMER: TextMatchTransformer = {
  dependencies: [EntityRefNode],
  export: (node) => {
    if (!(node instanceof EntityRefNode)) return null;
    const json = node.exportJSON();
    const label = (json.label || "Untitled").replace(/\]/g, "");
    return `[${label}](moduo://${json.entityType}/${json.entityId})`;
  },
  importRegExp: new RegExp(`\\[([^\\]]+)\\]\\(${MODUO_URI.source}\\)`),
  regExp: new RegExp(`\\[([^\\]]+)\\]\\(${MODUO_URI.source}\\)$`),
  replace: (textNode, match) => {
    const [, label, entityType, entityId] = match;
    textNode.replace(
      $createEntityRefNode({
        entityType: entityType!,
        entityId: entityId!,
        label: label!,
      }),
    );
  },
  trigger: ")",
  type: "text-match",
};

/** The full Notes transformer set. Order matters on import: the moduo
 * element transformers must beat the generic ones, and the entity-ref
 * text-match must beat LINK (or moduo:// URIs become plain links). */
export const NOTES_TRANSFORMERS: Transformer[] = [
  PAGE_ROW_TRANSFORMER,
  EMBED_TRANSFORMER,
  HR_TRANSFORMER,
  // Task lines carry an id comment CHECK_LIST would swallow — they go first.
  TASK_LINE_TRANSFORMER,
  // CHECK_LIST is NOT in ELEMENT_TRANSFORMERS, and must precede the bullet
  // transformer or `- [x]` imports as a literal-text bullet item.
  CHECK_LIST,
  ...ELEMENT_TRANSFORMERS,
  ...MULTILINE_ELEMENT_TRANSFORMERS,
  ...TEXT_FORMAT_TRANSFORMERS,
  ENTITY_REF_TRANSFORMER,
  ...TEXT_MATCH_TRANSFORMERS,
];

/** Paste heuristic: convert only when the plain text carries markdown BLOCK
 * syntax — a URL or plain prose must never round-trip through the parser. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.includes("\n") && !/^#{1,3} /.test(text)) return false;
  return /^(#{1,3} |[-*+] |\d+\. |> |```|- \[[ x]\] )/m.test(text);
}

// ── selection → markdown (the copy path) ────────────────────────────────────
// Copy works on a SELECTION, but @lexical/markdown only exports whole
// containers — so the copy plugin serializes the selected top-level blocks to
// plain JSON trees and this pure walker emits markdown. Testable without a
// clipboard or an editor.

export type MdJsonNode = {
  type: string;
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  checked?: boolean;
  start?: number;
  value?: number;
  url?: string;
  label?: string;
  entityType?: string;
  entityId?: string;
  noteId?: string;
  kind?: string;
  itemId?: string;
  taskId?: string | null;
  done?: boolean;
  children?: MdJsonNode[];
};

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_STRIKETHROUGH = 4;
const FORMAT_CODE = 16;

function inlineToMd(node: MdJsonNode): string {
  switch (node.type) {
    case "text": {
      let text = node.text ?? "";
      const format = typeof node.format === "number" ? node.format : 0;
      if (format & FORMAT_CODE) return `\`${text}\``;
      if (format & FORMAT_BOLD && format & FORMAT_ITALIC) text = `***${text}***`;
      else if (format & FORMAT_BOLD) text = `**${text}**`;
      else if (format & FORMAT_ITALIC) text = `*${text}*`;
      if (format & FORMAT_STRIKETHROUGH) text = `~~${text}~~`;
      return text;
    }
    case "linebreak":
      return "\n";
    case "entity-ref":
      return `[${(node.label || "Untitled").replace(/\]/g, "")}](moduo://${node.entityType}/${node.entityId})`;
    case "link":
    case "autolink":
      return `[${childrenToMd(node)}](${node.url ?? ""})`;
    default:
      // Text-ish leaves (code-highlight tokens etc.) carry .text directly.
      if (typeof node.text === "string") return node.text;
      return childrenToMd(node);
  }
}

function childrenToMd(node: MdJsonNode): string {
  return (node.children ?? []).map(inlineToMd).join("");
}

function listToMd(node: MdJsonNode, indent: string): string {
  const lines: string[] = [];
  // Ordered lists serialize their starting number on the LIST node (`start`);
  // per-item `value` is presentational.
  let n = typeof node.start === "number" && node.start > 0 ? node.start : 1;
  for (const item of node.children ?? []) {
    const nested = (item.children ?? []).filter((c) => c.type === "list");
    const inline = (item.children ?? []).filter((c) => c.type !== "list");
    const content = inline.map(inlineToMd).join("");
    if (content.trim() !== "" || nested.length === 0) {
      const marker =
        node.listType === "number"
          ? `${n}. `
          : node.listType === "check"
            ? `- [${item.checked ? "x" : " "}] `
            : "- ";
      lines.push(`${indent}${marker}${content}`);
      n += 1;
    }
    for (const sub of nested) lines.push(listToMd(sub, indent + "    "));
  }
  return lines.join("\n");
}

function blockToMd(node: MdJsonNode): string {
  switch (node.type) {
    case "heading": {
      const level = node.tag === "h1" ? "#" : node.tag === "h2" ? "##" : "###";
      return `${level} ${childrenToMd(node)}`;
    }
    case "quote":
      return childrenToMd(node)
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "code":
      return "```\n" + (node.children ?? []).map(inlineToMd).join("") + "\n```";
    case "list":
      return listToMd(node, "");
    case "horizontalrule":
      return "---";
    case "task-line": {
      const box = node.done ? "x" : " ";
      const title = childrenToMd(node);
      return node.taskId
        ? `- [${box}] ${title} <!-- moduo:task:${node.taskId} -->`
        : `- [${box}] ${title}`;
    }
    case "page-row":
      return `[${(node.label || "Untitled").replace(/\]/g, "")}](moduo://note/${node.noteId})`;
    case "embed":
      return node.kind === "mindmap" ? `[Mindmap](moduo://mindmap/${node.itemId})` : "";
    case "table": {
      const rows = (node.children ?? []).map((row) =>
        (row.children ?? []).map((cell) => childrenToMd(cell).replace(/\|/g, "\\|").trim()),
      );
      if (rows.length === 0) return "";
      const header = rows[0]!;
      const sep = header.map(() => "---");
      const body = rows.slice(1);
      return [header, sep, ...body].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
    }
    default:
      return childrenToMd(node);
  }
}

/** Markdown for a list of serialized top-level blocks. */
export function blocksToMarkdown(blocks: MdJsonNode[]): string {
  return blocks
    .map(blockToMd)
    .filter((s) => s !== "")
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Serialize a live Lexical node tree to the walker's JSON shape. Must run
 * inside an editor read/update. */
export function $nodeToMdJson(node: LexicalNode): MdJsonNode {
  const json = node.exportJSON() as unknown as MdJsonNode;
  const maybeElement = node as ElementNode & { getChildren?: () => LexicalNode[] };
  if (typeof maybeElement.getChildren === "function") {
    json.children = maybeElement.getChildren().map($nodeToMdJson);
  }
  return json;
}

/** The selected top-level blocks (deduped, document order) for the copy path.
 * Must run inside an editor read. */
export function $selectionTopBlocks(selectedNodes: LexicalNode[]): LexicalNode[] {
  const seen = new Set<string>();
  const blocks: LexicalNode[] = [];
  for (const node of selectedNodes) {
    let top: LexicalNode | null = node;
    while (top && top.getParent() && top.getParent()!.getType() !== "root") {
      top = top.getParent();
    }
    if (!top || top.getType() === "root") continue;
    if (!seen.has(top.getKey())) {
      seen.add(top.getKey());
      blocks.push(top);
    }
  }
  return blocks;
}
