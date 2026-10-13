/**
 * Lexical node views: the seam between a node's SCHEMA and how a browser
 * editor DRAWS it (specs/notes-refresh.md NR-3, assumption 2).
 *
 * A decorator node's class is its schema: type, fields, JSON, markdown. It
 * must load with no React, because the same classes run in the headless
 * materializer, the sync engine's markdown derivation and (NR-6) the MCP Edge
 * Function. So `decorate()` never imports a component; it asks this registry,
 * which the browser editor fills once at module load (`registerNodeView`).
 *
 * Off-screen there is no view and `decorate()` returns null, which is exactly
 * what a headless editor wants (it never renders decorators).
 */

import type { LexicalNode } from "lexical";

/** Draws one node. Returns a React element in the browser; typed `unknown` so
 * schema files never depend on React's types. */
export type NodeView = (node: LexicalNode) => unknown;

const views = new Map<string, NodeView>();

/** Install the view for a node type. Idempotent: the last install wins. */
export function registerNodeView(type: string, view: NodeView): void {
  views.set(type, view);
}

/** What a schema node's `decorate()` returns: its installed view, or null. */
export function renderNodeView(node: LexicalNode): unknown {
  const view = views.get(node.getType());
  return view ? view(node) : null;
}
