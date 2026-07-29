/**
 * Markdown-zip import planner (NO-8, AC11/AC14) — PURE. Turns a set of unzipped
 * `{ path, content }` files into a note tree: folders map to parent pages
 * (Notion-style — a file `A/B.md` parents to the file `A.md`), Notion hash
 * suffixes are stripped from titles + parent matching, and malformed / non-md
 * files are isolated with a reason (never fatal). The wizard maps each node's
 * deterministic `tempId` to a real note id and calls the batched
 * `notesV2.importNotes` op.
 */

import { positionsAfter } from "../tasks/helpers";

export type ImportFileEntry = { path: string; content: string };

export type ImportPlanNode = {
  tempId: string;
  parentTempId: string | null;
  title: string;
  md: string;
  path: string;
};

export type ImportSkip = { path: string; reason: string };

export type ImportPlan = {
  nodes: ImportPlanNode[];
  skipped: ImportSkip[];
};

const MD_EXT = /\.(md|markdown|txt)$/i;
/** Notion exports suffix names with " <32-hex>". */
const NOTION_HASH = /\s+[0-9a-f]{32}$/i;

function cleanName(name: string): string {
  return name.replace(MD_EXT, "").replace(NOTION_HASH, "").trim();
}

function titleFromPath(path: string, md: string): string {
  const base = path.split("/").pop() ?? path;
  const name = cleanName(base);
  if (name) return name;
  const firstLine = md.split("\n").find((l) => l.trim());
  return firstLine ? firstLine.replace(/^#+\s*/, "").trim() || "Untitled" : "Untitled";
}

/** Normalize a path segment for parent-matching (ext + hash stripped, lowered). */
function normSeg(seg: string): string {
  return cleanName(seg).toLowerCase();
}

/** A rough plain-text projection of markdown for the FTS `body_text` on import
 * (the editor rewrites it precisely on first edit). */
export function mdToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → label
    .replace(/<!--[\s\S]*?-->/g, " ") // html comments (e.g. task ids)
    .replace(/^[#>\-*+]\s+/gm, "") // block markers
    .replace(/[*_~]/g, "") // emphasis
    .replace(/\s+/g, " ")
    .trim();
}

export function planMdZipImport(entries: ImportFileEntry[]): ImportPlan {
  const skipped: ImportSkip[] = [];
  const files = entries.filter((e) => {
    if (!MD_EXT.test(e.path)) {
      skipped.push({ path: e.path, reason: "not a markdown file" });
      return false;
    }
    if (!e.content.trim()) {
      skipped.push({ path: e.path, reason: "empty file" });
      return false;
    }
    return true;
  });

  // First pass: assign deterministic tempIds and index each file by its
  // normalized full path (no extension), so parents resolve by name.
  const byNormPath = new Map<string, string>();
  const nodes: ImportPlanNode[] = files.map((f, i) => {
    const tempId = `n${i}`;
    const normFull = f.path.split("/").filter(Boolean).map(normSeg).join("/");
    // First writer wins if two files normalize to the same path (rare).
    if (!byNormPath.has(normFull)) byNormPath.set(normFull, tempId);
    return {
      tempId,
      parentTempId: null,
      title: titleFromPath(f.path, f.content),
      md: f.content,
      path: f.path,
    };
  });

  // Second pass: a file at `dir/…/name.md` parents to the page at `dir/….md`.
  files.forEach((f, i) => {
    const segs = f.path.split("/").filter(Boolean);
    if (segs.length <= 1) return; // root-level note
    const parentNorm = segs.slice(0, -1).map(normSeg).join("/");
    const parentId = byNormPath.get(parentNorm);
    if (parentId && parentId !== nodes[i].tempId) nodes[i].parentTempId = parentId;
    // No matching parent page → attaches to root (parentTempId stays null).
  });

  // Emit PARENTS BEFORE CHILDREN: `notes.parent_id` is a self-FK and
  // `notes_op_import` inserts rows in array order, catching FK violations as
  // "skipped". A zip that stores a child before its parent would otherwise
  // silently drop the child (validator M1). Topological order is deterministic
  // and the parent chain is acyclic (a strict path prefix).
  return { nodes: topoSortNodes(nodes), skipped };
}

function topoSortNodes(nodes: ImportPlanNode[]): ImportPlanNode[] {
  const byId = new Map(nodes.map((n) => [n.tempId, n]));
  const emitted = new Set<string>();
  const out: ImportPlanNode[] = [];
  const visit = (n: ImportPlanNode, stack: Set<string>) => {
    if (emitted.has(n.tempId) || stack.has(n.tempId)) return;
    const parent = n.parentTempId ? byId.get(n.parentTempId) : null;
    if (parent && !emitted.has(parent.tempId)) {
      stack.add(n.tempId);
      visit(parent, stack);
      stack.delete(n.tempId);
    }
    emitted.add(n.tempId);
    out.push(n);
  };
  for (const n of nodes) visit(n, new Set());
  return out;
}

/**
 * Sequential sibling positions for an import plan (NOTE-FIX-1).
 *
 * Every imported note used to land with `position: ""`, so a whole Notion
 * export arrived in arbitrary sibling order — the tree's `byPosition` sort
 * fell straight through to its `createdAt`/`id` tiebreak. The plan is already
 * in authored order (topologically sorted, files in read order), so numbering
 * each parent's children in plan order preserves what the user exported.
 */
export function importPositions(
  nodes: ImportPlanNode[],
  /** Positions of the notes that ALREADY exist at the import's root level.
   * Without these the import restarts at the first key and interleaves with
   * (or exactly collides with) the existing tree instead of appending. */
  existingRootPositions: string[] = [],
): Map<string, string> {
  const byParent = new Map<string, ImportPlanNode[]>();
  for (const n of nodes) {
    const key = n.parentTempId ?? "";
    const group = byParent.get(key);
    if (group) group.push(n);
    else byParent.set(key, [n]);
  }
  const out = new Map<string, string>();
  for (const [parentKey, group] of byParent) {
    // Imported children always start fresh (their parent is new too); only the
    // root level shares a sibling list with notes that already exist.
    const after = parentKey === "" ? existingRootPositions : [];
    const positions = positionsAfter(group.length, after);
    group.forEach((n, i) => out.set(n.tempId, positions[i]!));
  }
  return out;
}

export type ImportRow = {
  id: string;
  parentId: string | null;
  title: string;
  position: string;
  docStateB64: string | null;
  bodyText: string;
  bodyMd: string;
};

/**
 * Turn a plan into the rows `notes_op_import` stores (NOTE-FIX-1) — including
 * each note's fully-built CRDT `doc_state`, so an imported note renders on
 * every device and after every reload instead of only in the session that
 * imported it.
 *
 * `buildDoc` is injected to keep this module pure/testable and to let the
 * caller decide what a build failure means. A note whose markdown can't be
 * built still imports with its body intact — it just stays blank in the editor
 * until the repair sweep retries it, which is strictly better than dropping it.
 */
export function buildImportRows(
  nodes: ImportPlanNode[],
  idFor: (tempId: string) => string,
  buildDoc: (
    noteId: string,
    md: string,
  ) => { docStateB64: string; bodyText: string; bodyMd: string } | null,
  existingRootPositions: string[] = [],
): ImportRow[] {
  const positions = importPositions(nodes, existingRootPositions);
  return nodes.map((n) => {
    const id = idFor(n.tempId);
    let built: { docStateB64: string; bodyText: string; bodyMd: string } | null = null;
    try {
      built = buildDoc(id, n.md);
    } catch {
      built = null;
    }
    return {
      id,
      parentId: n.parentTempId ? (idFor(n.parentTempId) ?? null) : null,
      title: n.title,
      position: positions.get(n.tempId) ?? "",
      docStateB64: built?.docStateB64 ?? null,
      // ALWAYS the raw file, never the doc-derived body. `deriveBody` is lossy
      // (link URLs, inline marks, intra-block line breaks, tables), and
      // `body_md` is the copy that feeds search, export, the published page
      // and the MCP connector. The doc carries the rich version.
      bodyText: mdToPlainText(n.md),
      bodyMd: n.md,
    };
  });
}
