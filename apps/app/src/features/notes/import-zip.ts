/**
 * Notion-export zip unwrapping (IM-1, AC1) — PURE apart from `fflate`.
 *
 * A real Notion export is a **zip inside a zip**: `Export-<uuid>.zip` contains
 * `Export-<uuid>-Part-1.zip`, which contains the files. The old reader decoded
 * only markdown entries at the top level, so dropping the file exactly as
 * downloaded produced **zero** notes. Large workspaces split into `Part-2`,
 * `Part-3`… which must merge whether they arrive together or one at a time.
 *
 * Non-markdown entries are returned too (with empty content) rather than dropped,
 * so the planner can classify and *count* them — AC3 wants "3 files skipped"
 * broken down by kind, which is impossible if the reader silently eats them.
 */

import { strFromU8, unzipSync } from "fflate";

import type { ImportFileEntry } from "./import";

/**
 * How many archives to open *inside* the one that was dropped.
 *
 * 1 is the observed Notion shape (the dropped wrapper → `Part-N`), so two
 * archives are opened in total. Bounded on purpose: an unbounded unwrap over
 * untrusted input is a zip-bomb path (specs/import.md assumption 2). Note the
 * bound limits *nesting*, not size — `unzipSync` still materializes every entry
 * eagerly, so a flat bomb is not defended against here.
 */
export const MAX_NESTED_ZIP_DEPTH = 1;

const MD_EXT = /\.(md|markdown|txt)$/i;
const ZIP_EXT = /\.zip$/i;

/**
 * Unwrap a zip (recursively, bounded) into flat `{ path, content }` entries.
 *
 * Paths keep their in-zip directories — the planner needs them to resolve
 * parents — but a nested zip's own name is dropped from the path, because
 * `Export-<uuid>-Part-1.zip/` is packaging, not hierarchy: keeping it would make
 * every page a child of a phantom "Part 1" page, and would split a multi-part
 * export into unrelated trees.
 */
export function unwrapZipEntries(
  bytes: Uint8Array,
  depth = MAX_NESTED_ZIP_DEPTH,
): ImportFileEntry[] {
  const out: ImportFileEntry[] = [];
  const files = unzipSync(bytes);
  for (const [path, data] of Object.entries(files)) {
    if (path.endsWith("/")) continue; // directory entry
    if (ZIP_EXT.test(path)) {
      if (depth <= 0) {
        // Report it rather than dropping it: a deeper nesting than we unwrap
        // would otherwise look like a silently empty import.
        out.push({ path, content: "" });
        continue;
      }
      try {
        out.push(...unwrapZipEntries(data, depth - 1));
      } catch {
        out.push({ path, content: "" });
      }
      continue;
    }
    // Decode only text-ish payloads; everything else is carried by path alone so
    // the planner can count it by kind.
    out.push({ path, content: MD_EXT.test(path) ? strFromU8(data) : "" });
  }
  return out;
}

/**
 * Notion's export wrapper: `Export-<uuid>/`, then the workspace bucket
 * (`Private & Shared/`, `Private/`, `Teamspaces/`) that sits above every page.
 */
const EXPORT_WRAPPER = /^Export-[0-9a-f-]{32,36}\//i;
const WORKSPACE_BUCKET = /^(Private & Shared|Private|Shared|Teamspaces)\//i;

/**
 * Drop the Notion export wrapper from a path (AC2).
 *
 * Matched by **pattern, per entry** — deliberately not "the longest prefix common
 * to every entry". A set-derived prefix makes every path (and therefore every
 * derived id) a function of the shallowest file in the drop, so one new
 * top-level teamspace, or dropping Part-2 on its own, silently re-keys the whole
 * export and a re-import duplicates it. Pattern matching is stable across drops.
 *
 * The wrapper is packaging, not pages: left in place it shifts the whole tree
 * down two levels and shows the user depth they never made.
 */
export function stripExportWrapper(path: string): string {
  const withoutExport = path.replace(/^\/+/, "").replace(EXPORT_WRAPPER, "");
  // Only strip the bucket when it sat *under* the export wrapper — a folder the
  // user happened to name "Private" at the root of their own zip is theirs.
  return withoutExport === path ? withoutExport : withoutExport.replace(WORKSPACE_BUCKET, "");
}

/**
 * Read one or more dropped files into import entries: zips are unwrapped
 * (recursively), markdown is taken as-is, anything else is carried by path so it
 * gets counted as skipped. Multi-part exports merge because every part's entries
 * land in one flat list before the wrapper prefix is stripped.
 */
export function readImportFiles(
  files: { name: string; bytes?: Uint8Array; text?: string }[],
): ImportFileEntry[] {
  const entries: ImportFileEntry[] = [];
  for (const file of files) {
    if (ZIP_EXT.test(file.name) && file.bytes) {
      try {
        entries.push(...unwrapZipEntries(file.bytes));
      } catch {
        // One unreadable zip must not take the whole drop down with it — the
        // other files still plan, and this one is reported as skipped.
        entries.push({ path: file.name, content: "" });
      }
    } else if (MD_EXT.test(file.name)) {
      entries.push({ path: file.name, content: file.text ?? "" });
    } else {
      entries.push({ path: file.name, content: "" });
    }
  }
  // Windows-written zips use backslashes; normalize before anything reads a path
  // as hierarchy, or the whole path becomes one title.
  return entries.map((e) => ({ ...e, path: stripExportWrapper(e.path.replace(/\\/g, "/")) }));
}
