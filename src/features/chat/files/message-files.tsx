// A message's files in the stream (CV-9, spec §7; round 5, frame 5): pictures
// and PDFs preview inline inside the feed's media box (360 × 240, their
// stored size fit inside it, so the row's height is known before they load),
// with equal space above and below; everything else is a file chip. A click
// opens the app's file viewer. The files are read through the attachments
// policy (only readers of the conversation get them) and shown through
// short-lived signed links.

import { useEffect, useState, useSyncExternalStore } from "react";
import { CHAT_FILE_LINK_TTL_SECONDS } from "@contracts/attachments";
import { Progress } from "@/components/ui/progress";
import { fileIconFor } from "@/features/attachments/files";
import { signPaths } from "@/features/attachments/signed-urls";
import { AttachmentViewer } from "@/features/attachments/ui/attachment-viewer";
import type { AttachmentRecord, ModuoRuntime } from "@/lib/runtime.types";
import { getUploadQueue } from "@/lib/uploads";
import { formatBytes } from "@/lib/uploads/errors";
import { cn } from "@/lib/utils";
import type { ChatFile, ChatMessage, ChatRuntime } from "../model";
import { fileShape, fitMedia } from "./model";

// ── Reading: one request per burst of rows, cached by message ───────────────

type Cache = {
  files: Map<string, ChatFile[]>;
  wanted: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<() => void>;
  version: number;
};

const caches = new WeakMap<ChatRuntime, Cache>();

function cacheFor(chat: ChatRuntime): Cache {
  let c = caches.get(chat);
  if (!c) {
    c = { files: new Map(), wanted: new Set(), timer: null, listeners: new Set(), version: 0 };
    caches.set(chat, c);
  }
  return c;
}

function request(chat: ChatRuntime, messageId: string) {
  const c = cacheFor(chat);
  if (c.files.has(messageId) || c.wanted.has(messageId)) return;
  c.wanted.add(messageId);
  c.timer ??= setTimeout(() => {
    c.timer = null;
    const ids = [...c.wanted];
    c.wanted.clear();
    void chat.messageFiles?.(ids).then((res) => {
      if (res.error) return; // asked again when the row shows next
      const byMessage = new Map<string, ChatFile[]>(ids.map((id) => [id, []]));
      for (const f of res.data) byMessage.get(f.messageId)?.push(f);
      for (const [id, files] of byMessage) c.files.set(id, files);
      c.version += 1;
      for (const fn of c.listeners) fn();
    });
  }, 16);
}

/** A sent message's files (null while they load). */
export function useMessageFiles(chat: ChatRuntime | null, messageId: string): ChatFile[] | null {
  const c = chat ? cacheFor(chat) : null;
  useSyncExternalStore(
    (fn) => {
      if (!c) return () => {};
      c.listeners.add(fn);
      return () => c.listeners.delete(fn);
    },
    () => c?.version ?? 0,
  );
  useEffect(() => {
    if (chat) request(chat, messageId);
  }, [chat, messageId]);
  return c?.files.get(messageId) ?? null;
}

/** Tests only. */
export function clearMessageFilesCache(chat: ChatRuntime): void {
  caches.delete(chat);
}

/** Signed links for these paths (null until they're made). */
export function useSignedLinks(
  runtime: Pick<ModuoRuntime, "attachments"> | null,
  paths: readonly string[],
  ttlSeconds: number,
): ReadonlyMap<string, string> | null {
  const key = paths.join("\n");
  const [links, setLinks] = useState<{ key: string; map: ReadonlyMap<string, string> } | null>(null);
  useEffect(() => {
    if (!runtime || !key) return;
    let live = true;
    void signPaths(runtime, key.split("\n"), ttlSeconds)
      .then((map) => {
        if (live) setLinks({ key, map });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, key, ttlSeconds]);
  return links?.key === key ? links.map : null;
}

/** A chat file as the app's viewer reads a file. */
export function asAttachmentRecord(f: ChatFile): AttachmentRecord {
  return {
    id: f.id,
    entityType: "chat_message",
    entityId: f.messageId,
    uploaderId: f.authorId,
    fileName: f.fileName,
    mime: f.mime,
    sizeBytes: f.sizeBytes,
    width: f.width,
    height: f.height,
    status: "ready",
    deletedAt: null,
    createdAt: f.sentAt,
    objectPath: f.objectPath,
    previewPath: f.previewPath,
    previewMime: (f.previewMime as AttachmentRecord["previewMime"]) ?? null,
  };
}

/** The path a file's inline preview reads: its preview, else (a picture or a PDF) itself. */
export function inlinePath(f: ChatFile): string | null {
  const shape = fileShape(f);
  if (shape === "image") return f.previewPath ?? f.objectPath;
  if (shape === "pdf") return f.objectPath;
  return null;
}

// ── Drawing ─────────────────────────────────────────────────────────────────

export function MessageFiles({
  message,
  runtime,
}: {
  message: ChatMessage;
  runtime: ModuoRuntime | null;
}) {
  if (message.sendState) return <UnsentFiles messageId={message.id} />;
  return <SentFiles message={message} runtime={runtime} />;
}

function SentFiles({ message, runtime }: { message: ChatMessage; runtime: ModuoRuntime | null }) {
  const files = useMessageFiles(runtime?.chat ?? null, message.id);
  const [open, setOpen] = useState<number | null>(null);
  const paths = (files ?? []).flatMap((f) => {
    const p = inlinePath(f);
    return p ? [p] : [];
  });
  const links = useSignedLinks(runtime, paths, CHAT_FILE_LINK_TTL_SECONDS.preview);
  if (!files) {
    // The row keeps its place while the files load: one media box.
    return <div aria-hidden className="my-2 h-feed-media-h w-feed-media max-w-full rounded-md bg-muted" />;
  }
  if (files.length === 0) return null;
  const media = files.filter((f) => fileShape(f) !== "chip");
  const chips = files.filter((f) => fileShape(f) === "chip");
  const records = files.map(asAttachmentRecord);
  const previews = new Map<string, string>();
  for (const f of files) {
    const p = f.previewPath ? links?.get(f.previewPath) : null;
    if (p) previews.set(f.id, p);
  }
  const indexOf = (f: ChatFile) => files.indexOf(f);
  return (
    <div data-slot="message-files" className="my-2 flex flex-col items-start gap-2">
      {media.map((f) => {
        const path = inlinePath(f);
        const url = path ? (links?.get(path) ?? null) : null;
        return fileShape(f) === "pdf" ? (
          <PdfPreview key={f.id} file={f} url={url} onOpen={() => setOpen(indexOf(f))} />
        ) : (
          <ImagePreview key={f.id} file={f} url={url} onOpen={() => setOpen(indexOf(f))} />
        );
      })}
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {chips.map((f) => (
            <FileChip key={f.id} file={f} onOpen={() => setOpen(indexOf(f))} />
          ))}
        </div>
      ) : null}
      {open !== null ? (
        <AttachmentViewer
          runtime={runtime}
          records={records}
          previews={previews}
          index={open}
          onIndexChange={setOpen}
          canEdit={false}
          onDelete={() => {}}
        />
      ) : null}
    </div>
  );
}

function ImagePreview({
  file,
  url,
  onOpen,
}: {
  file: ChatFile;
  url: string | null;
  onOpen: () => void;
}) {
  const box = fitMedia(file.width, file.height);
  return (
    <button
      type="button"
      data-slot="file-image"
      aria-label={`Open ${file.fileName}`}
      title={file.fileName}
      onClick={onOpen}
      className="block max-w-full overflow-hidden rounded-md bg-muted ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {url ? (
        <img
          src={url}
          alt={file.fileName}
          width={box.width}
          height={box.height}
          draggable={false}
          className="block max-w-full object-cover"
        />
      ) : (
        <svg aria-hidden width={box.width} height={box.height} className="block max-w-full" />
      )}
    </button>
  );
}

function PdfPreview({
  file,
  url,
  onOpen,
}: {
  file: ChatFile;
  url: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-slot="file-pdf"
      aria-label={`Open ${file.fileName}`}
      title={file.fileName}
      onClick={onOpen}
      className="relative flex h-feed-media-h w-feed-media max-w-full flex-col overflow-hidden rounded-md bg-muted text-left ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {url ? (
        <iframe
          src={`${url}#toolbar=0&navpanes=0&view=FitH`}
          title={file.fileName}
          loading="lazy"
          tabIndex={-1}
          className="pointer-events-none min-h-0 w-full flex-1 bg-card"
        />
      ) : (
        <span className="min-h-0 flex-1" />
      )}
      <span className="flex h-9 shrink-0 items-center gap-2 border-t border-hairline bg-card px-2.5">
        <FileTypeIcon mime={file.mime} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {file.fileName}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
      </span>
    </button>
  );
}

function FileTypeIcon({ mime }: { mime: string }) {
  const Icon = fileIconFor(mime);
  return <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />;
}

function FileChip({ file, onOpen }: { file: ChatFile; onOpen: () => void }) {
  const Icon = fileIconFor(file.mime);
  return (
    <button
      type="button"
      data-slot="file-chip"
      aria-label={`Open ${file.fileName}`}
      title={file.fileName}
      onClick={onOpen}
      className="flex h-12 w-feed-media max-w-full items-center gap-3 rounded-md px-3 text-left ring-1 ring-hairline ring-inset outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-state-active text-muted-foreground">
        <Icon className="size-icon-sm" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-md font-medium text-foreground">{file.fileName}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</span>
    </button>
  );
}

/** Your message on its way: its files' uploads, as the queue moves them. */
function UnsentFiles({ messageId }: { messageId: string }) {
  const queue = getUploadQueue();
  const snap = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const items = snap.items.filter(
    (i) => i.target.entityType === "chat_message" && i.target.entityId === messageId,
  );
  if (items.length === 0) return null;
  return (
    <div data-slot="message-files" className="my-2 flex flex-wrap gap-2 opacity-60">
      {items.map((i) => {
        const Icon = fileIconFor(i.mime);
        const stopped = i.state === "failed" || i.state === "rejected";
        return (
          <div
            key={i.id}
            data-slot="file-uploading"
            className={cn(
              "flex h-12 w-feed-media max-w-full items-center gap-3 rounded-md px-3 ring-1 ring-hairline ring-inset",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-state-active text-muted-foreground">
              <Icon className="size-icon-sm" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm font-medium text-foreground">{i.fileName}</span>
              {stopped ? (
                <span className="text-xs text-muted-foreground">Not uploaded</span>
              ) : (
                <Progress value={i.loaded} max={i.total || i.sizeBytes} label={`Uploading ${i.fileName}`} />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
