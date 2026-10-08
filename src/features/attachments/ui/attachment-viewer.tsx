// The attachment viewer (specs/attachments.md "Viewer", AT2-2): full size,
// ←/→ between the entity's files, Download, Copy (images) and Delete. The
// original loads only here (10-minute link); the preview fills in while it does.

import { ATTACHMENT_LINK_TTL_SECONDS } from "@contracts/attachments";
import { ChevronLeft, ChevronRight, Copy, Download, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import type { AttachmentRecord, ModuoRuntime } from "@/lib/runtime.types";
import { formatBytes } from "@/lib/uploads/errors";
import { fileIconFor, isPreviewableImage, saveBlob, toPng } from "../files";
import { signPaths } from "../signed-urls";

export type AttachmentViewerProps = {
  runtime: Pick<ModuoRuntime, "attachments"> | null;
  records: AttachmentRecord[];
  previews: ReadonlyMap<string, string>;
  /** The open file's index, or null when closed. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
  canEdit: boolean;
  onDelete: (rec: AttachmentRecord) => void;
};

export function AttachmentViewer({
  runtime,
  records,
  previews,
  index,
  onIndexChange,
  canEdit,
  onDelete,
}: AttachmentViewerProps) {
  const open = index != null && index >= 0 && index < records.length;
  const rec = open ? records[index] : null;
  const count = records.length;
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);

  // Close when the open file goes away (deleted elsewhere, or the last one).
  useEffect(() => {
    if (index != null && index >= records.length) {
      onIndexChange(records.length > 0 ? records.length - 1 : null);
    }
  }, [index, records.length, onIndexChange]);

  const image = !!rec && isPreviewableImage(rec.mime) && !!rec.previewPath;
  const objectPath = rec?.objectPath ?? null;
  useEffect(() => {
    setOriginalUrl(null);
    if (!runtime || !objectPath || !image) return;
    let live = true;
    void signPaths(runtime, [objectPath], ATTACHMENT_LINK_TTL_SECONDS.original)
      .then((m) => {
        if (live) setOriginalUrl(m.get(objectPath) ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, objectPath, image]);

  const go = (delta: number) => {
    if (index == null || count < 2) return;
    onIndexChange((index + delta + count) % count);
  };

  const fetchOriginal = async (): Promise<Blob> => {
    if (!runtime || !rec?.objectPath) throw new Error("No file");
    const m = await signPaths(runtime, [rec.objectPath], ATTACHMENT_LINK_TTL_SECONDS.original);
    const url = m.get(rec.objectPath);
    if (!url) throw new Error("No link");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  };

  const download = async () => {
    if (!rec || busy) return;
    setBusy("download");
    try {
      saveBlob(rec.fileName, await fetchOriginal());
    } catch {
      toast.error("Couldn't download the file.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!rec || busy) return;
    setBusy("copy");
    try {
      // Safari wants the promise handed over inside the click.
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": fetchOriginal().then(toPng) }),
      ]);
      toast("Image copied");
    } catch {
      toast.error("Couldn't copy the image.");
    } finally {
      setBusy(null);
    }
  };

  const previewUrl = rec?.previewPath ? (previews.get(rec.previewPath) ?? null) : null;
  const Icon = rec ? fileIconFor(rec.mime) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] w-[calc(100vw-4rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
        }}
      >
        {rec ? (
          <>
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline pr-2 pl-4">
              <div className="flex min-w-0 flex-1 flex-col">
                <DialogTitle className="truncate font-display text-sm font-medium">
                  {rec.fileName}
                </DialogTitle>
                <DialogDescription className="font-sans text-xs tabular-nums">
                  {formatBytes(rec.sizeBytes)}
                  {rec.width && rec.height ? ` · ${rec.width} × ${rec.height}` : ""}
                  {count > 1 ? ` · ${(index ?? 0) + 1} of ${count}` : ""}
                </DialogDescription>
              </div>
              {image ? (
                <IconButton
                  icon={Copy}
                  label="Copy image"
                  disabled={busy != null}
                  onClick={() => void copy()}
                />
              ) : null}
              <IconButton
                icon={Download}
                label="Download"
                disabled={busy != null}
                onClick={() => void download()}
              />
              {canEdit ? (
                <IconButton icon={Trash2} label="Delete" onClick={() => onDelete(rec)} />
              ) : null}
              <IconButton icon={X} label="Close" onClick={() => onIndexChange(null)} />
            </div>
            <div className="relative flex min-h-64 flex-1 items-center justify-center overflow-auto bg-muted/40 p-4">
              {image ? (
                <img
                  key={rec.id}
                  src={originalUrl ?? previewUrl ?? undefined}
                  alt={rec.fileName}
                  className="max-h-[75vh] max-w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  {Icon ? (
                    <Icon className="size-icon-lg text-muted-foreground" aria-hidden />
                  ) : null}
                  <p className="font-sans text-sm text-foreground">{rec.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    No preview for this file. Download it to open it.
                  </p>
                </div>
              )}
              {count > 1 ? (
                <>
                  <IconButton
                    icon={ChevronLeft}
                    label="Previous"
                    tooltip="Previous (←)"
                    size="md"
                    variant="outline"
                    className="absolute top-1/2 left-3 -translate-y-1/2"
                    onClick={() => go(-1)}
                  />
                  <IconButton
                    icon={ChevronRight}
                    label="Next"
                    tooltip="Next (→)"
                    size="md"
                    variant="outline"
                    className="absolute top-1/2 right-3 -translate-y-1/2"
                    onClick={() => go(1)}
                  />
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
