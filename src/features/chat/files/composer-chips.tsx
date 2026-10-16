// The files waiting in the composer (CV-9; round 5, frame 6 "upload": a
// 48-tall chip per file above the line, a thumbnail or the file's icon, its
// name, a thin progress bar while it goes up). × takes it back out.

import { X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { fileIconFor } from "@/features/attachments/files";
import { formatBytes } from "@/lib/uploads/errors";
import { cn } from "@/lib/utils";
import type { ComposerFile } from "./composer-files";

export function ComposerFileChips({
  files,
  notice,
  onRemove,
}: {
  files: readonly ComposerFile[];
  notice: string | null;
  onRemove: (key: string) => void;
}) {
  if (files.length === 0 && !notice) return null;
  return (
    <div data-slot="composer-files" className="flex basis-full flex-col gap-1 px-1 pt-1">
      {files.length > 0 ? (
        <ul aria-label="Files to send" className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.key}>
              <ComposerChip file={f} onRemove={() => onRemove(f.key)} />
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? (
        <p role="status" className="px-1 text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function ComposerChip({ file, onRemove }: { file: ComposerFile; onRemove: () => void }) {
  const Icon = fileIconFor(file.mime);
  const pct = file.total > 0 ? Math.round((file.loaded / file.total) * 100) : 0;
  const detail =
    file.state === "failed"
      ? (file.problem ?? "Not attached")
      : file.state === "uploading"
        ? `${pct}%`
        : formatBytes(file.sizeBytes);
  return (
    <div
      data-slot="composer-file"
      data-state={file.state}
      title={file.state === "failed" ? (file.problem ?? file.fileName) : file.fileName}
      className={cn(
        "group/file relative flex h-12 max-w-feed-media min-w-50 items-center gap-2.5 rounded-md px-2.5 ring-1 ring-hairline ring-inset",
        file.state === "failed" && "opacity-60",
      )}
    >
      {file.thumb ? (
        <img
          src={file.thumb}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-sm bg-muted object-cover"
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-state-active text-muted-foreground">
          <Icon className="size-icon-sm" aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium text-foreground">{file.fileName}</span>
        {file.state === "uploading" ? (
          <Progress value={file.loaded} max={file.total} label={`Uploading ${file.fileName}`} />
        ) : (
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        )}
      </span>
      <button
        type="button"
        aria-label={`Remove ${file.fileName}`}
        onClick={onRemove}
        className="hit-min shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        <X aria-hidden className="size-icon-xs" />
      </button>
    </div>
  );
}
