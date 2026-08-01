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

/** Why a file didn't import, and what kind of file it was (AC3). */
export type ImportSkipKind = "csv" | "image" | "empty" | "nested-archive" | "unknown";

export type ImportSkip = { path: string; reason: string; kind: ImportSkipKind };

export type ImportPlan = {
  nodes: ImportPlanNode[];
  skipped: ImportSkip[];
  /** Skipped counts per kind, so the summary can say *what* was left out
   * ("3 CSVs · 15 images") instead of a bare number the user can't act on. */
  skippedByKind: Record<ImportSkipKind, number>;
};

const MD_EXT = /\.(md|markdown|txt)$/i;
/** Notion exports suffix names with " <32-hex>". */
const NOTION_HASH = /\s+[0-9a-f]{32}$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif)$/i;
const CSV_EXT = /\.(csv|tsv)$/i;
const ZIP_EXT = /\.zip$/i;

/** Classify a non-importable entry so the summary can break skips down by kind. */
function skipKind(path: string): ImportSkipKind {
  if (CSV_EXT.test(path)) return "csv";
  if (IMAGE_EXT.test(path)) return "image";
  if (ZIP_EXT.test(path)) return "nested-archive";
  return "unknown";
}

function countByKind(skipped: ImportSkip[]): Record<ImportSkipKind, number> {
  const counts: Record<ImportSkipKind, number> = {
    csv: 0,
    image: 0,
    empty: 0,
    "nested-archive": 0,
    unknown: 0,
  };
  for (const s of skipped) counts[s.kind] += 1;
  return counts;
}

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
      const kind = skipKind(e.path);
      skipped.push({
        path: e.path,
        reason:
          kind === "nested-archive"
            ? "archive couldn't be read, or is nested deeper than we unwrap"
            : "not a markdown file",
        kind,
      });
      return false;
    }
    if (!e.content.trim()) {
      skipped.push({ path: e.path, reason: "empty file", kind: "empty" });
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
  return { nodes: topoSortNodes(nodes), skipped, skippedByKind: countByKind(skipped) };
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
    group.forEach((n, i) => {
      out.set(n.tempId, positions[i]!);
    });
  }
  return out;
}

/** Notion suffixes every exported page file with its own 32-hex page id. */
const NOTION_PAGE_ID = /\s+([0-9a-f]{32})(?:\.[a-z0-9]+)?$/i;

/**
 * Notion's own page id for an exported file, if the export carries one.
 *
 * The spec calls this "the join key" for a reason: it is the only part of an
 * export that is genuinely stable and genuinely unique. Titles are not — Notion
 * appends the hex *precisely because* two sibling pages can share a name — and
 * paths are not stable across a re-export (a page moves, a teamspace appears).
 */
export function notionPageId(path: string): string | null {
  const base = path.split("/").pop() ?? path;
  return base.match(NOTION_PAGE_ID)?.[1]?.toLowerCase() ?? null;
}

/**
 * A deterministic note id for an imported file (AC4).
 *
 * Re-running the same import must not duplicate anything, and `notes_op_import`
 * is idempotent **per row id** (an existing id is skipped server-side). The
 * wizard used to mint `crypto.randomUUID()` per node, so the second run of the
 * same export inserted a second copy of all 350 pages — the op's idempotency was
 * unreachable.
 *
 * Seeded on **Notion's page id** when the export carries one, falling back to the
 * normalized path. Seeding on the path alone is unsafe in both directions: two
 * sibling pages with the same title normalize to the same path (so one would be
 * silently dropped by the id-exists skip), and a page that merely *moved* between
 * exports would re-key and duplicate. Use [`assignImportIds`] rather than calling
 * this directly — it guarantees the uniqueness this function alone cannot.
 *
 * A 128-bit FNV-1a-based digest formatted as a v4-shaped UUID (~115 effective
 * bits — the four passes share a prime, so a handful of low bits are correlated;
 * at export scale the collision probability is ~1e-30). `crypto.subtle` is async,
 * which this synchronous planning path can't use.
 */
export function stableNoteId(workspaceId: string, seedPath: string): string {
  const seed = `${workspaceId}\u0000${seedPath}`;
  // Four independently-offset 32-bit FNV-1a passes → 128 bits.
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((offset) => {
    let hash = offset >>> 0;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  });
  const hex = words.map((w) => w.toString(16).padStart(8, "0")).join("");
  // Stamp the version (4) and variant (10xx) nibbles so the value is a
  // well-formed UUID for the `uuid` columns it lands in.
  const version = `4${hex.slice(13, 16)}`;
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20);
  return [hex.slice(0, 8), hex.slice(8, 12), version, variant, hex.slice(20, 32)].join("-");
}

/**
 * Stable ids for a whole plan, **guaranteed distinct**.
 *
 * The guarantee is the point. Two pages that share a seed would otherwise collide
 * on the primary key, and `notes_op_import` resolves a duplicate id by *skipping
 * the second row* — so a collision doesn't error, it silently deletes a page and
 * reparents its children under the survivor. A page with no Notion id whose title
 * cleans to empty (the sample export has four) collides with every other such
 * page, so this is a real shape, not a hypothetical.
 *
 * Collisions are broken deterministically by plan order, so the discriminator is
 * itself stable across re-runs.
 */
export function assignImportIds(workspaceId: string, nodes: ImportPlanNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  const seenSeed = new Map<string, number>();
  for (const node of nodes) {
    const base =
      notionPageId(node.path) ?? node.path.split("/").filter(Boolean).map(normSeg).join("/");
    const nth = seenSeed.get(base) ?? 0;
    seenSeed.set(base, nth + 1);
    let id = stableNoteId(workspaceId, nth === 0 ? base : `${base}#${nth}`);
    // Belt and braces: a genuine hash collision between two different seeds.
    for (let bump = 1; used.has(id); bump++) {
      id = stableNoteId(workspaceId, `${base}#${nth}~${bump}`);
    }
    used.add(id);
    out.set(node.tempId, id);
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

/**
 * Human summary of what an import left out, by kind (AC3): "3 CSVs · 15 images".
 * A bare "18 skipped" tells the user nothing they can act on — and silently
 * dropping non-page files is exactly what made the old importer feel lossy.
 */
export function describeSkips(counts: Record<ImportSkipKind, number>): string {
  const label: Record<ImportSkipKind, [string, string]> = {
    csv: ["CSV", "CSVs"],
    image: ["image", "images"],
    empty: ["empty file", "empty files"],
    "nested-archive": ["nested archive", "nested archives"],
    unknown: ["other file", "other files"],
  };
  const parts = (Object.keys(label) as ImportSkipKind[])
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${counts[kind]} ${label[kind][counts[kind] === 1 ? 0 : 1]}`);
  return parts.length ? parts.join(" · ") : "nothing";
}
