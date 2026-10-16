// The conversation's Files view (CV-9, spec §7; the panel's "about this" view
// ⌥3, registered by CV-8b; round 5 frame 4's Files list): every file sent
// here, newest first, with who sent it and when. A click opens the file in the
// app's viewer; "Show more" reads the next page.

import { CHAT_FILE_LINK_TTL_SECONDS } from "@contracts/attachments";
import { useCallback, useEffect, useState } from "react";
import { fileIconFor } from "@/features/attachments/files";
import { AttachmentViewer } from "@/features/attachments/ui/attachment-viewer";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { formatPastDay } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import type { ChatFile, ChatPerson } from "../model";
import { firstName } from "../stream/rows";
import { asAttachmentRecord, inlinePath, useSignedLinks } from "./message-files";

const PAGE = 50;

const ROW = cn(
  "flex h-(--row-h-sm) w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none",
  "transition-colors duration-(--motion-fade) ease-(--ease-out)",
  "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
);

export function FilesView({
  runtime,
  channelId,
  selfId,
  personOf,
  refreshKey,
}: {
  runtime: ModuoRuntime | null;
  channelId: string;
  selfId: string | null;
  personOf: (userId: string) => ChatPerson | undefined;
  /** Changes when a message with files lands or leaves: read again. */
  refreshKey?: string | number;
}) {
  const chat = runtime?.chat ?? null;
  const [files, setFiles] = useState<ChatFile[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const read = useCallback(
    async (before: ChatFile | null) => {
      if (!chat?.files) return;
      const res = await chat.files({
        channelId,
        before: before ? { sentAt: before.sentAt, id: before.id } : null,
        limit: PAGE,
      });
      if (res.error) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setMore(res.data.length === PAGE);
      setFiles((prev) => (before && prev ? [...prev, ...res.data] : res.data));
    },
    [chat, channelId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey asks for a fresh first page.
  useEffect(() => {
    void read(null);
  }, [read, refreshKey]);

  const previewPaths = (files ?? []).flatMap((f) => {
    const path = inlinePath(f);
    return path ? [path] : [];
  });
  const links = useSignedLinks(
    open !== null ? runtime : null,
    previewPaths,
    CHAT_FILE_LINK_TTL_SECONDS.preview,
  );

  if (!files) {
    return (
      <p className="px-3 text-sm text-subtle-foreground">
        {failed ? "Couldn't load the files." : "Loading…"}
      </p>
    );
  }
  if (files.length === 0) {
    return (
      <p className="px-3 text-sm text-subtle-foreground" data-slot="files-empty">
        No files yet. Paste, drop or attach them in a message.
      </p>
    );
  }
  const previews = new Map<string, string>();
  for (const f of files) {
    // Keyed by path: the viewer reads its preview by the record's previewPath.
    const path = inlinePath(f);
    const url = path ? links?.get(path) : null;
    if (path && url) previews.set(path, url);
  }
  return (
    <div className="flex flex-col gap-0.5 px-1 pb-3" data-slot="files-view">
      <ul className="flex flex-col gap-px" aria-label="Files in this conversation">
        {files.map((f, i) => {
          const Icon = fileIconFor(f.mime);
          return (
            <li key={f.id}>
              <button
                type="button"
                data-file={f.id}
                title={f.fileName}
                onClick={() => setOpen(i)}
                className={ROW}
              >
                <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-foreground">{f.fileName}</span>
                <span className="shrink-0 text-xs text-subtle-foreground">
                  {firstName(f.authorId, selfId, personOf)} · {formatPastDay(f.sentAt)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {more ? (
        <button
          type="button"
          className={cn(ROW, "text-muted-foreground")}
          onClick={() => void read(files[files.length - 1] ?? null)}
        >
          Show more
        </button>
      ) : null}
      {open !== null ? (
        <AttachmentViewer
          runtime={runtime}
          records={files.map(asAttachmentRecord)}
          previews={previews}
          index={open}
          onIndexChange={setOpen}
          canEdit={false}
          onDelete={() => {}}
          originalTtlSeconds={CHAT_FILE_LINK_TTL_SECONDS.original}
        />
      ) : null}
    </div>
  );
}
