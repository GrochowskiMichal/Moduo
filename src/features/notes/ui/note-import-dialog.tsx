/**
 * Markdown import wizard (NO-8, AC11): drop a `.zip` (e.g. a Notion export) or
 * `.md`/`.txt` files → preview the note tree (folders → parents) → one batched
 * attributed `notes_op_import`. Malformed / non-markdown files are isolated and
 * counted (never fatal). Imported bodies land in `body_md`/`body_text` and
 * materialize in the editor on first open (see import-seed.ts).
 */

import { useCallback, useMemo, useState } from "react";
import { FileUp, FolderTree } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { mdToPlainText, planMdZipImport, type ImportFileEntry, type ImportPlan } from "../import";
import { readZipMarkdown } from "../export";
import { registerNoteSeed } from "../import-seed";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

export function NoteImportDialog({ runtime, workspaceId, open, onOpenChange, onImported }: Props) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);

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
    const entries: ImportFileEntry[] = [];
    for (const file of Array.from(files)) {
      if (/\.zip$/i.test(file.name)) {
        try {
          entries.push(...readZipMarkdown(new Uint8Array(await file.arrayBuffer())));
        } catch {
          toast.error(`Couldn’t read ${file.name}`);
        }
      } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
        entries.push({ path: file.name, content: await file.text() });
      } else {
        entries.push({ path: file.name, content: "" }); // planner skips it, counted
      }
    }
    setPlan(planMdZipImport(entries));
  }, []);

  const confirm = async () => {
    if (!plan || !runtime || !workspaceId) return;
    setBusy(true);
    try {
      const idMap = new Map<string, string>();
      for (const n of plan.nodes) idMap.set(n.tempId, crypto.randomUUID());
      const rows = plan.nodes.map((n) => ({
        id: idMap.get(n.tempId)!,
        parentId: n.parentTempId ? (idMap.get(n.parentTempId) ?? null) : null,
        title: n.title,
        position: "",
        docStateB64: null,
        bodyText: mdToPlainText(n.md),
        bodyMd: n.md,
      }));
      const res = await runtime.notesV2.importNotes({ workspaceId, rows });
      // Materialize each imported note's editor doc on first open (this session).
      for (const n of plan.nodes) registerNoteSeed(idMap.get(n.tempId)!, n.md);
      const skipped = res.skipped + plan.skipped.length;
      toast.success(`Imported ${res.imported} note${res.imported === 1 ? "" : "s"}`, {
        description: skipped ? `${skipped} skipped` : undefined,
      });
      setPlan(null);
      onOpenChange(false);
      onImported();
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : undefined });
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
            <span>Drop files here, or click to choose</span>
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
                Skipped: {plan.skipped.map((s) => s.path).join(", ")}
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
          <Button onClick={() => void confirm()} disabled={!plan || busy || plan.nodes.length === 0}>
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
