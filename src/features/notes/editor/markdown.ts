/**
 * Markdown at every door (Wave-3 NO-4, AC11): the Notes transformer set for
 * @lexical/markdown plus the paste heuristic. Moduo entities serialize as
 * `[label](moduo://type/id)` — lossless enough to re-import (chips inline,
 * page-rows as a standalone line).
 *
 * This is the ONLY markdown dialect (NR-3): typing, paste, copy, import, the
 * derived `body_md` (`doc-markdown.ts`) and so export, publish and MCP reads
 * all go through `NOTES_TRANSFORMERS`. Schema imports only: no React.
 *
 * NOTE (vitest gotcha): everything here is imported by tests — keep VALUE
 * imports relative, never `@/`.
 */

import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/extension";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
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
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import { $createParagraphNode, $isTextNode } from "lexical";
import { $createEntityRefNode, EntityRefNode } from "../../spine/editor/entity-ref-schema";
import { $createEmbedNode, $isEmbedNode, EmbedNode } from "./schema/embed-node";
import { $createPageRowNode, $isPageRowNode, PageRowNode } from "./schema/page-row-node";
import { $createTaskLineNode, $isTaskLineNode, TaskLineNode } from "./schema/task-line-node";

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

const TABLE_ROW = /^\|(.+)\|\s?$/;
const TABLE_DIVIDER = /^(\| ?:?-+:? ?)+\|\s?$/;

/** A row's cells, or null when the line isn't a table row. `\|` inside a
 * cell is an escaped pipe, not a cell boundary. */
function splitTableRow(line: string): string[] | null {
  const match = line.match(TABLE_ROW);
  if (!match) return null;
  return match[1]!.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function $tableCell(markdown: string): TableCellNode {
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  // Inline syntax (bold, links, chips) inside a cell imports like anywhere else.
  // `<br>` is GFM's line break inside a cell (a cell can't span lines).
  $convertFromMarkdownString(markdown.replace(/<br\s*\/?>/gi, "\n"), NOTES_TRANSFORMERS, cell);
  return cell;
}

/** GFM tables ⇄ table blocks. @lexical/markdown ships none, so a table used
 * to export as nothing and import as literal pipes. The first row is always
 * the header (GFM requires one), so markdown → note → markdown is stable. */
export const TABLE_TRANSFORMER: ElementTransformer = {
  dependencies: [TableNode, TableRowNode, TableCellNode],
  export: (node) => {
    if (!$isTableNode(node)) return null;
    const lines: string[] = [];
    for (const row of node.getChildren()) {
      if (!$isTableRowNode(row)) continue;
      const cells = row
        .getChildren()
        .filter($isTableCellNode)
        .map((cell) =>
          $convertToMarkdownString(NOTES_TRANSFORMERS, cell)
            .trim()
            .replace(/\|/g, "\\|")
            .replace(/\n+/g, "<br>"),
        );
      lines.push(`| ${cells.join(" | ")} |`);
      if (lines.length === 1) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
    return lines.join("\n");
  },
  regExp: TABLE_ROW,
  replace: (parentNode, _children, match, isImport) => {
    // Import only: typing `|x| ` in prose must not turn the line into a table.
    if (!isImport) return false;
    const previous = parentNode.getPreviousSibling();
    if (TABLE_DIVIDER.test(match[0])) {
      // The divider marks the row above as the header.
      if (!$isTableNode(previous)) return false;
      const header = previous.getLastChild();
      if ($isTableRowNode(header)) {
        for (const cell of header.getChildren()) {
          if ($isTableCellNode(cell)) cell.setHeaderStyles(TableCellHeaderStates.ROW);
        }
      }
      parentNode.remove();
      return;
    }
    const cells = splitTableRow(match[0]);
    if (!cells) return false;
    const row = $createTableRowNode();
    for (const cell of cells) row.append($tableCell(cell));
    if ($isTableNode(previous)) {
      // Pad or trim to the table's width so the grid stays rectangular.
      const width = (previous.getFirstChild() as TableRowNode | null)?.getChildrenSize() ?? 0;
      while (row.getChildrenSize() < width) row.append($tableCell(""));
      while (width > 0 && row.getChildrenSize() > width) row.getLastChild()?.remove();
      previous.append(row);
      parentNode.remove();
      return;
    }
    const table = $createTableNode();
    table.append(row);
    parentNode.replace(table);
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
  TABLE_TRANSFORMER,
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
