/**
 * Notes markdown interchange (NO-8, AC11) — per-note `.md` export, whole-tree
 * `.zip` export (folders per parent note), and reading a dropped `.zip` back
 * into markdown entries for the import wizard. The filename + zip-entry shaping
 * is pure (testable); the download + (un)zip touch the DOM / fflate.
 */

import { strToU8, zipSync } from "fflate";

import type { Note } from "./model";
import { displayTitle } from "./title";

/** Sanitize a note title into a safe filename stem (no extension). */
export function safeFileStem(title: string): string {
  const clean = (title || "Untitled")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || "Untitled";
}

export function noteFileName(title: string): string {
  return `${safeFileStem(title)}.md`;
}

export type ZipNote = { id: string; title: string; md: string; pathSegments: string[] };

/**
 * A note and its sub-pages as zip entries: each sits in folders named after
 * its ancestors below the exported note (the note itself at the top level).
 */
export function subtreeZipNotes(
  notes: readonly Pick<Note, "id" | "title" | "parentId">[],
  rootId: string,
  ids: readonly string[],
  mdById: ReadonlyMap<string, string>,
): ZipNote[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const pathOf = (id: string): string[] => {
    const chain: string[] = [];
    let cur = id === rootId ? null : (byId.get(id)?.parentId ?? null);
    while (cur && chain.length < 12) {
      const parent = byId.get(cur);
      if (!parent) break;
      chain.unshift(displayTitle(parent.title));
      if (cur === rootId) break;
      cur = parent.parentId ?? null;
    }
    return chain;
  };
  return ids.flatMap((id) => {
    const note = byId.get(id);
    return note
      ? [
          {
            id,
            title: displayTitle(note.title),
            md: mdById.get(id) ?? "",
            pathSegments: pathOf(id),
          },
        ]
      : [];
  });
}

/** Build the `{ path: bytes }` map for a tree zip — each note's ancestor titles
 * become folders; sibling name collisions get a numeric suffix. Pure. */
export function buildZipEntries(notes: ZipNote[]): Record<string, Uint8Array> {
  const seen = new Set<string>();
  const entries: Record<string, Uint8Array> = {};
  for (const n of notes) {
    const dir = n.pathSegments.map(safeFileStem).join("/");
    const prefix = dir ? `${dir}/` : "";
    const stem = safeFileStem(n.title);
    let name = `${prefix}${stem}.md`;
    for (let i = 2; seen.has(name); i++) name = `${prefix}${stem} (${i}).md`;
    seen.add(name);
    entries[name] = strToU8(n.md || `# ${n.title}\n`);
  }
  return entries;
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, text: string): void {
  triggerDownload(filename, new Blob([text], { type: "text/markdown;charset=utf-8" }));
}

export function downloadZip(filename: string, entries: Record<string, Uint8Array>): void {
  const zipped = zipSync(entries, { level: 6 });
  triggerDownload(filename, new Blob([zipped as BlobPart], { type: "application/zip" }));
}
