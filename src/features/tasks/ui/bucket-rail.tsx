import { useEffect, useRef, useState } from "react";
import { Inbox, Layers, MoreHorizontal, Plus } from "lucide-react";

import { Input } from "../../../components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { cn } from "../../../lib/utils";
import type { Bucket } from "../model";

export type TasksMode = "plan" | "execute";

type Props = {
  mode: TasksMode;
  onModeChange: (mode: TasksMode) => void;
  selection: string; // "all" | "inbox" | bucketId
  onSelect: (selection: string) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  openCountByBucket: Map<string, number>;
  driftCountByBucket: Map<string, number>;
  totalOpenCount: number;
  canEdit: boolean;
  onCreateBucket: (name: string) => void;
  onRenameBucket: (id: string, name: string) => void;
  onDeleteBucket: (id: string) => void;
};

export function BucketRail({
  mode,
  onModeChange,
  selection,
  onSelect,
  buckets,
  inbox,
  openCountByBucket,
  driftCountByBucket,
  totalOpenCount,
  canEdit,
  onCreateBucket,
  onRenameBucket,
  onDeleteBucket,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ModeToggle mode={mode} onModeChange={onModeChange} />

      <div className="min-h-0 flex-1 overflow-auto">
        <nav className="flex flex-col gap-0.5" aria-label="Buckets">
          <SelectionRow
            icon={<Layers className="size-4" aria-hidden />}
            label="All"
            count={totalOpenCount}
            active={selection === "all"}
            onClick={() => onSelect("all")}
          />
          {inbox ? (
            <SelectionRow
              icon={<Inbox className="size-4" aria-hidden />}
              label="Inbox"
              count={openCountByBucket.get(inbox.id) ?? 0}
              drift={driftCountByBucket.get(inbox.id) ?? 0}
              active={selection === "inbox" || selection === inbox.id}
              onClick={() => onSelect("inbox")}
            />
          ) : null}

          {buckets.length > 0 ? (
            <div className="mt-3 mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              Buckets
            </div>
          ) : null}

          {buckets.map((bucket) => (
            <BucketRow
              key={bucket.id}
              bucket={bucket}
              count={openCountByBucket.get(bucket.id) ?? 0}
              drift={driftCountByBucket.get(bucket.id) ?? 0}
              active={selection === bucket.id}
              canEdit={canEdit}
              onClick={() => onSelect(bucket.id)}
              onRename={(name) => onRenameBucket(bucket.id, name)}
              onDelete={() => onDeleteBucket(bucket.id)}
            />
          ))}
        </nav>
      </div>

      {canEdit ? <AddBucket onCreate={onCreateBucket} /> : null}
    </div>
  );
}

// ── mode toggle ───────────────────────────────────────────────────────────────

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: TasksMode;
  onModeChange: (mode: TasksMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Tasks mode"
      className="flex shrink-0 items-center gap-1 rounded-md bg-muted p-1"
    >
      {(["plan", "execute"] as const).map((value) => (
        <button
          key={value}
          role="tab"
          aria-selected={mode === value}
          onClick={() => onModeChange(value)}
          className={cn(
            "flex-1 rounded px-2 py-1 text-sm capitalize transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mode === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

// ── rows ──────────────────────────────────────────────────────────────────────

function RowShell({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        {children}
      </button>
    </div>
  );
}

function CountAndDrift({ count, drift }: { count: number; drift?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs">
      {drift && drift > 0 ? (
        // Ambient drift — soft, never red, never "overdue" (principles 4 & 5).
        <span className="text-muted-foreground/80" title={`${drift} drifted`}>
          · {drift} drifted
        </span>
      ) : null}
      {count > 0 ? <span className="text-muted-foreground/70 tabular-nums">{count}</span> : null}
    </span>
  );
}

function SelectionRow({
  icon,
  label,
  count,
  drift,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  drift?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <RowShell active={active} onClick={onClick}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <CountAndDrift count={count} drift={drift} />
    </RowShell>
  );
}

function BucketRow({
  bucket,
  count,
  drift,
  active,
  canEdit,
  onClick,
  onRename,
  onDelete,
}: {
  bucket: Bucket;
  count: number;
  drift: number;
  active: boolean;
  canEdit: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(bucket.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [renaming]);

  if (renaming) {
    return (
      <div className="px-2 py-0.5">
        <Input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRename(value);
              setRenaming(false);
            } else if (e.key === "Escape") {
              setValue(bucket.name);
              setRenaming(false);
            }
          }}
          onBlur={() => {
            onRename(value);
            setRenaming(false);
          }}
          className="h-7 px-1.5 py-0 text-sm"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={() => canEdit && setRenaming(true)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{bucket.name}</span>
      </button>
      <CountAndDrift count={count} drift={drift} />
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${bucket.name} options`}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete bucket
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

// ── add bucket (instant, no cooldown) ─────────────────────────────────────────

function AddBucket({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-4" aria-hidden />
        New bucket
      </button>
    );
  }

  const commit = (keepOpen: boolean) => {
    const name = value.trim();
    if (name) onCreate(name);
    setValue("");
    if (!keepOpen) setOpen(false);
    else ref.current?.focus();
  };

  return (
    <div className="shrink-0 px-1">
      <Input
        ref={ref}
        value={value}
        placeholder="Bucket name — Enter to add"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(true); // instant, keep open for rapid adds
          else if (e.key === "Escape") {
            setValue("");
            setOpen(false);
          }
        }}
        onBlur={() => commit(false)}
        className="h-8 text-sm"
      />
    </div>
  );
}
