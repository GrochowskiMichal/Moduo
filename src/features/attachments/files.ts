// Getting files out of drag and paste events, plus the small file actions the
// strip and viewer share (AT-2). With `dragDropEnabled: false` on the desktop
// window, a Finder drop arrives as the same HTML5 `File`s the web gets.

import type { LucideIcon } from "lucide-react";
import {
  FileArchive,
  FileAudio,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from "lucide-react";

/** Is a drag carrying files (not text, not an in-app dnd-kit drag)? */
export function dragHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes("Files");
}

/** Files from a drop (directories and empty entries are left out). */
export function filesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue;
      const entry = (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => { isDirectory: boolean } | null;
        }
      ).webkitGetAsEntry?.();
      if (entry?.isDirectory) continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
    return out;
  }
  return Array.from(dt.files ?? []);
}

/**
 * Files a paste should attach: only when the clipboard holds files and no text
 * (a copied screenshot), so pasting text into a field stays a text paste.
 */
export function pastedFiles(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const types = Array.from(dt.types ?? []);
  if (types.includes("text/plain") || types.includes("text/html")) return [];
  return filesFromDataTransfer(dt);
}

export function isPreviewableImage(mime: string): boolean {
  return mime.startsWith("image/");
}

export function fileIconFor(mime: string): LucideIcon {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (/zip|compressed|x-tar|gzip|x-7z|x-rar/.test(mime)) return FileArchive;
  if (/sheet|excel|csv/.test(mime)) return FileSpreadsheet;
  if (mime === "application/pdf" || mime.startsWith("text/") || /word|document/.test(mime)) {
    return FileText;
  }
  return FileIcon;
}

/** Save a blob under a file name (web and the desktop webview alike). */
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to pick the URL up before letting it go.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The clipboard takes PNG only (reliably): convert anything else. */
export async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!png) throw new Error("Couldn't convert the image.");
    return png;
  } finally {
    bmp.close();
  }
}
