// The attachment strip (specs/attachments.md "Where they show", comp §5
// `.attstrip`): thumbnails right under a task's description. Images are 64×44
// thumbnails; other files are a type-icon tile with name + size; the "+" tile
// opens the file picker. Uploads show in place with their progress, and a file
// that couldn't attach gets one quiet caption line under the strip with its
// one way forward (AT2-4): facts with numbers, never red, never a dialog.
// Presentational: the data and actions come from `useEntityAttachments`.

import { CloudOff, Plus, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AttachmentRecord } from "@/lib/runtime.types";
import {
  ACTION_LABELS,
  almostFullCaption,
  describeProblem,
  describeTooLarge,
  formatBytes,
  type ProblemAction,
  type ProblemCopy,
} from "@/lib/uploads/errors";
import type { UploadView } from "@/lib/uploads/queue";
import { cn } from "@/lib/utils";
import { fileIconFor } from "../files";

export type AttachmentStripProps = {
  records: AttachmentRecord[];
  previews: ReadonlyMap<string, string>;
  uploads: UploadView[];
  almostFull: { usedBytes: number; totalBytes: number } | null;
  canEdit: boolean;
  isOwner: boolean;
  onAddFiles: (files: File[]) => void;
  onOpen: (index: number) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissAlmostFull: () => void;
  onUpgrade?: () => void;
  /** Settings → Storage's largest files (AT-3); hidden until it exists. */
  onFreeUpSpace?: () => void;
  className?: string;
};

const TILE =
  "relative shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-hairline outline-none transition-[box-shadow,opacity] duration-(--motion-fade) ease-(--ease-out) focus-visible:ring-2 focus-visible:ring-ring/50";

export function AttachmentStrip({
  records,
  previews,
  uploads,
  almostFull,
  canEdit,
  isOwner,
  onAddFiles,
  onOpen,
  onRetry,
  onDismiss,
  onDismissAlmostFull,
  onUpgrade,
  onFreeUpSpace,
  className,
}: AttachmentStripProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = uploads.filter((u) => u.state !== "rejected");
  const notices = useMemo(() => problemNotices(uploads, isOwner), [uploads, isOwner]);

  if (records.length === 0 && inFlight.length === 0 && notices.length === 0 && !canEdit) {
    return null;
  }

  const run = (action: ProblemAction, ids: string[]) => {
    if (action === "retry") for (const id of ids) onRetry(id);
    else if (action === "dismiss") for (const id of ids) onDismiss(id);
    else if (action === "upgrade") onUpgrade?.();
    else if (action === "free_space") onFreeUpSpace?.();
  };
  const available = (a: ProblemAction) =>
    (a !== "upgrade" || !!onUpgrade) && (a !== "free_space" || !!onFreeUpSpace);

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-slot="attachment-strip">
      <ul className="flex flex-wrap gap-1.5" aria-label="Attachments">
        {records.map((rec, index) => (
          <li key={rec.id}>
            <ReadyTile
              rec={rec}
              previewUrl={rec.previewPath ? (previews.get(rec.previewPath) ?? null) : null}
              onOpen={() => onOpen(index)}
            />
          </li>
        ))}
        {inFlight.map((u) => (
          <li key={u.id}>
            <UploadTile upload={u} />
          </li>
        ))}
        {canEdit ? (
          <li>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Add files"
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    TILE,
                    "flex size-11 items-center justify-center text-muted-foreground hover:bg-state-hover hover:text-foreground",
                  )}
                >
                  <Plus className="size-icon-sm" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add files, or paste or drop them anywhere on the task</TooltipContent>
            </Tooltip>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) onAddFiles(files);
              }}
            />
          </li>
        ) : null}
      </ul>

      {notices.map((n) => (
        <Caption
          key={n.key}
          copy={{ ...n.copy, actions: n.copy.actions.filter(available) }}
          onAction={(a) => run(a, n.ids)}
        />
      ))}
      {almostFull ? (
        <Caption
          copy={{
            text: almostFullCaption(almostFull.usedBytes, almostFull.totalBytes),
            actions: ["dismiss"],
          }}
          onAction={() => onDismissAlmostFull()}
        />
      ) : null}
    </div>
  );
}

type Notice = { key: string; ids: string[]; copy: ProblemCopy };

/** One caption per file with a problem; too-big files from one drop share a line. */
export function problemNotices(uploads: UploadView[], isOwner: boolean): Notice[] {
  const out: Notice[] = [];
  const tooLarge = new Map<string, UploadView[]>();
  for (const u of uploads) {
    if (!u.problem) continue;
    if (u.problem.kind === "too_large") {
      const group = tooLarge.get(u.batchId) ?? [];
      group.push(u);
      tooLarge.set(u.batchId, group);
      continue;
    }
    if (u.state === "uploading") continue;
    out.push({
      key: u.id,
      ids: [u.id],
      copy: describeProblem(u.problem, { fileName: u.fileName, isOwner }),
    });
  }
  for (const [batchId, group] of tooLarge) {
    const first = group[0].problem;
    if (first?.kind !== "too_large") continue;
    out.push({
      key: `too-large:${batchId}`,
      ids: group.map((u) => u.id),
      copy: describeTooLarge(
        group.map((u) => ({ fileName: u.fileName, sizeBytes: u.sizeBytes })),
        { perFileBytes: first.perFileBytes, tier: first.tier, isOwner },
      ),
    });
  }
  return out;
}

function Caption({ copy, onAction }: { copy: ProblemCopy; onAction: (a: ProblemAction) => void }) {
  const actions = copy.actions.filter((a) => a !== "dismiss");
  const dismissable = copy.actions.includes("dismiss");
  return (
    <p className="flex min-w-0 items-start gap-1 text-xs text-muted-foreground" role="status">
      <span className="min-w-0 flex-1">
        {copy.text}
        {actions.map((a) => (
          <span key={a}>
            {" · "}
            <button
              type="button"
              onClick={() => onAction(a)}
              className="rounded-sm font-display text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {ACTION_LABELS[a]}
            </button>
          </span>
        ))}
      </span>
      {dismissable ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onAction("dismiss")}
          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-icon-xs" aria-hidden />
        </button>
      ) : null}
    </p>
  );
}

function ReadyTile({
  rec,
  previewUrl,
  onOpen,
}: {
  rec: AttachmentRecord;
  previewUrl: string | null;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  if (rec.previewPath && !broken) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${rec.fileName}`}
        title={rec.fileName}
        className={cn(TILE, "block h-11 w-16 bg-muted hover:opacity-90")}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            draggable={false}
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
        ) : null}
        {/* the hairline sits over the picture, as in the comp */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-hairline"
        />
      </button>
    );
  }
  return (
    <FileTile
      name={rec.fileName}
      mime={rec.mime}
      detail={formatBytes(rec.sizeBytes)}
      onClick={onOpen}
      label={`Open ${rec.fileName}`}
    />
  );
}

function FileTile({
  name,
  mime,
  detail,
  onClick,
  label,
  dim,
  children,
}: {
  name: string;
  mime: string;
  detail: React.ReactNode;
  onClick?: () => void;
  label?: string;
  dim?: boolean;
  children?: React.ReactNode;
}) {
  const Icon = fileIconFor(mime);
  const body = (
    <>
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-col text-left">
        <span className="truncate font-sans text-xs text-foreground">{name}</span>
        <span className="truncate font-sans text-2xs text-muted-foreground tabular-nums">
          {detail}
        </span>
      </span>
      {children}
    </>
  );
  const cls = cn(
    TILE,
    "flex h-11 max-w-48 min-w-24 items-center gap-2 px-2.5",
    onClick && "hover:bg-state-hover",
    dim && "opacity-60",
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={label} title={name} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls} title={name}>
      {body}
    </div>
  );
}

/** A local preview of a file still uploading (the server has no preview yet). */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function UploadTile({ upload }: { upload: UploadView }) {
  const url = useObjectUrl(upload.preview);
  const moving = upload.state === "uploading" || upload.state === "queued";
  const pct = upload.total > 0 ? Math.round((upload.loaded / upload.total) * 100) : 0;
  const StateIcon =
    upload.problem?.kind === "offline"
      ? CloudOff
      : upload.state === "waiting" || upload.state === "failed"
        ? RotateCw
        : null;
  const label =
    upload.state === "uploading"
      ? `Uploading ${upload.fileName}, ${pct}%`
      : moving
        ? `${upload.fileName}, waiting to upload`
        : `${upload.fileName}, not attached yet`;

  if (url) {
    return (
      <div
        role="img"
        aria-label={label}
        title={upload.fileName}
        className={cn(TILE, "h-11 w-16 bg-muted")}
      >
        <img src={url} alt="" draggable={false} className="size-full object-cover opacity-60" />
        {moving ? (
          <Progress
            value={upload.loaded}
            max={upload.total}
            label={`Uploading ${upload.fileName}`}
            className="absolute inset-x-1.5 bottom-1.5 w-auto"
          />
        ) : StateIcon ? (
          <span className="absolute inset-0 flex items-center justify-center text-foreground">
            <StateIcon className="size-icon-sm" aria-hidden />
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <FileTile
      name={upload.fileName}
      mime={upload.mime}
      dim={!moving}
      detail={
        upload.state === "uploading"
          ? `${pct}% of ${formatBytes(upload.sizeBytes)}`
          : moving
            ? "Waiting…"
            : "Not attached yet"
      }
    >
      {StateIcon && !moving ? (
        <StateIcon className="size-icon-xs shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
    </FileTile>
  );
}
