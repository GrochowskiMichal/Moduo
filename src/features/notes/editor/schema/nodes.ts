/**
 * The Notes editor's registered Lexical node set — ONE list, shared by the live
 * editor (`note-editor.tsx`), the headless materializer (`materialize.ts`) and
 * the markdown derivation (`doc-markdown.ts`).
 *
 * These must never drift: a node registered in one place but not the other
 * either throws on import or silently degrades the block to plain text.
 *
 * Schema only (NR-3): nothing in this list, or anything it imports, may load
 * React. Decorators draw through the node-view registry, which only the
 * browser editor fills (`../views`).
 */

import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { HorizontalRuleNode } from "@lexical/extension";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";
import { EntityRefNode } from "../../../spine/editor/entity-ref-schema";
import { EmbedNode } from "./embed-node";
import { PageRowNode } from "./page-row-node";
import { TaskLineNode } from "./task-line-node";

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
