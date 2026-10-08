/**
 * Markdown import wizard (NO-8, AC11): drop a `.zip` (e.g. a Notion export) or
 * `.md`/`.txt` files → preview the note tree (folders → parents) → one batched
 * attributed `notes_op_import`. Malformed / non-markdown files are isolated and
 * counted (never fatal).
 *
 * Each row carries a fully-built `doc_state` (NOTE-FIX-1) — the CRDT doc is
 * materialized here, at import time, so an imported note renders on every
 * device and after every reload. It used to ship an empty doc plus an
 * in-memory seed that only survived the importing session, which made a
 * next-day open look like the app had eaten the import.
 */

import { FileUp, FolderTree } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { buildDocStateFromMarkdown } from "../editor/materialize";
import {
  assignImportIds,
  buildImportRows,
  describeSkips,
  type ImportPlan,
  planMdZipImport,
} from "../import";
import { readImportFiles } from "../import-zip";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
  /** Root-level positions already in the tree, so the import appends. */
  existingRootPositions?: string[];
};

/** Rows per `notes_op_import` call. Each row now carries a full CRDT snapshot
 * (~5× its markdown), so a big Notion export in ONE request could exceed the
 * gateway body limit and fail the whole import. The op is idempotent per row
 * (an existing id is skipped), so chunking is safe and a failed chunk leaves
 * the earlier ones landed. */
const IMPORT_CHUNK = 50;

export function NoteImportDialog({
  runtime,
  workspaceId,
  open,
  onOpenChange,
  onImported,
  existingRootPositions = [],
}: Props) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  /** Notes committed so far, for the determinate bar (AC5). */
  const [progress, setProgress] = useState(0);

  const depthById = useMemo(() => {
    const m = new Map<string, number>();
    if (plan) {
      const byId = new Map(plan.nodes.map((x) => [x.tempId, x]));
      for (const n of plan.nodes) {
        let d = 0;
        let cur = n.parentTempId;
        while (cur && d < 12) {
          d++;
          cur = byId.get(cur)?.parentTempId ?? null;
        }
        m.set(n.tempId, d);
      }
    }
    return m;
  }, [plan]);

  const readFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setReading(true);
    try {
      // Read every dropped file first, then unwrap/merge in one pass so a
      // multi-part export dropped together becomes ONE tree (AC1).
      const read = await Promise.all(
        Array.from(files).map(async (file) =>
          /\.zip$/i.test(file.name)
            ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
            : { name: file.name, text: await file.text().catch(() => "") },
        ),
      );
      setPlan(planMdZipImport(readImportFiles(read)));
    } catch (e) {
      toast.error("Couldn’t read those files", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setReading(false);
    }
  }, []);

  const confirm = async () => {
    if (!plan || !runtime || !workspaceId) return;
    setBusy(true);
    try {
      // Building every note's CRDT doc is synchronous and CPU-bound; yield once
      // so the "Importing…" state actually paints before the UI blocks.
      await new Promise((r) => setTimeout(r, 0));
      // Deterministic ids (AC4): `notes_op_import` skips a row whose id already
      // exists, so a re-run of the same export is a no-op and a partially-failed
      // import resumes instead of duplicating. Random ids made that unreachable.
      // `assignImportIds` guarantees distinctness — a duplicate id would not
      // error, it would silently drop the second page.
      const idMap = assignImportIds(workspaceId, plan.nodes);
      // Each row carries its fully-built CRDT doc (NOTE-FIX-1).
      const rows = buildImportRows(
        plan.nodes,
        (tempId) => idMap.get(tempId)!,
        buildDocStateFromMarkdown,
        existingRootPositions,
      );
      let imported = 0;
      let skippedRows = 0;
      setProgress(0);
      // Chunked: parents are topologically before their children in the plan,
      // so chunking in order never orphans a child behind an unlanded parent.
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const res = await runtime.notesV2.importNotes({
          workspaceId,
          rows: rows.slice(i, i + IMPORT_CHUNK),
        });
        imported += res.imported;
        skippedRows += res.skipped;
        setProgress(Math.min(i + IMPORT_CHUNK, rows.length));
        // Yield between chunks so the bar actually repaints — building the CRDT
        // docs above is synchronous and CPU-bound.
        await new Promise((r) => setTimeout(r, 0));
      }
      // Keep the two kinds of "skipped" apart: files that were never pages, and
      // rows already imported by a previous run. Merging them reads as a failure
      // on a re-import, which is exactly when it is working correctly.
      const alreadyImported = skippedRows;
      const notPages = plan.skipped.length;
      const detail = [
        alreadyImported ? `${alreadyImported} already imported` : null,
        notPages ? `${notPages} not a page` : null,
      ].filter(Boolean);
      toast(`Imported ${imported} note${imported === 1 ? "" : "s"}`, {
        description: detail.length ? detail.join(" · ") : undefined,
      });
      setPlan(null);
      setProgress(0);
      onOpenChange(false);
      onImported();
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : undefined });
      // A chunked import can land partially — refresh so what DID import shows.
      onImported();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPlan(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import notes</DialogTitle>
          <DialogDescription>
            Drop a Markdown <code>.zip</code> (e.g. a Notion export) or <code>.md</code> files.
            Folders become parent notes.
          </DialogDescription>
        </DialogHeader>

        {!plan ? (
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground hover:bg-muted/70"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void readFiles(e.dataTransfer.files);
            }}
          >
            <FileUp className="size-6" aria-hidden />
            <span>{reading ? "Reading…" : "Drop files here, or click to choose"}</span>
            <input
              type="file"
              multiple
              accept=".md,.markdown,.txt,.zip"
              className="hidden"
              onChange={(e) => void readFiles(e.target.files)}
            />
          </label>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              {plan.nodes.length} note{plan.nodes.length === 1 ? "" : "s"} to import
              {plan.skipped.length ? ` · ${plan.skipped.length} skipped` : ""}.
            </p>
            {busy ? (
              <div className="space-y-1">
                <Progress
                  value={progress}
                  max={plan.nodes.length}
                  label={`Importing ${plan.nodes.length} notes`}
                />
                <p className="text-xs text-muted-foreground" role="status">
                  Imported {Math.min(progress, plan.nodes.length)} of {plan.nodes.length}…
                </p>
              </div>
            ) : null}
            <div className="max-h-64 overflow-y-auto rounded-md border border-border scrollbar-thin">
              <ul className="p-1">
                {plan.nodes.map((n) => (
                  <li
                    key={n.tempId}
                    className="flex items-center gap-1.5 px-1.5 py-1 text-sm text-foreground"
                    style={{ paddingLeft: `${(depthById.get(n.tempId) ?? 0) * 14 + 6}px` }}
                  >
                    <FolderTree className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{n.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            {plan.skipped.length ? (
              <p className="text-xs text-muted-foreground">
                Skipped {describeSkips(plan.skippedByKind)}. These stay in your export file — only
                pages become notes.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {plan ? (
            <Button variant="ghost" onClick={() => setPlan(null)} disabled={busy}>
              Choose different files
            </Button>
          ) : null}
          <Button
            onClick={() => void confirm()}
            disabled={!plan || busy || reading || plan.nodes.length === 0}
          >
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
