/**
 * The Notes editor's registered Lexical node set — ONE list, shared by the live
 * editor (`note-editor.tsx`) and the headless materializer (`materialize.ts`).
 *
 * These must never drift: the materializer builds a note's CRDT doc off-screen
 * and the live editor renders it. A node registered in one place but not the
 * other either throws on import or silently degrades the block to plain text.
 */

import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableNode, TableCellNode, TableRowNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";

import { EmbedNode } from "./nodes/EmbedNode";
import { TaskLineNode } from "./nodes/task-line-node";
import { PageRowNode } from "./nodes/page-row-node";
import { EntityRefNode } from "../../spine/editor/entity-ref-node";

export const NOTE_EDITOR_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  HorizontalRuleNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  EmbedNode,
  EntityRefNode,
  PageRowNode,
  TaskLineNode,
];
