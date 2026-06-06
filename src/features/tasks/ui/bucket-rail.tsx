import { useEffect, useRef, useState } from "react";
import { Inbox, Layers, MoreHorizontal, Plus, Sunrise } from "lucide-react";

import { Input } from "../../../components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { Bucket } from "../model";

export type TasksMode = "plan" | "execute";

// Primary (display) font for structure/labels; secondary (body) for meta/counts.
const SECTION_LABEL =
  "px-2 font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground/70";

type Props = {
  mode: TasksMode;
  onModeChange: (mode: TasksMode) => void;
  selection: string; // "all" | "today" | "inbox" | bucketId
  onSelect: (selection: string) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  openCountByBucket: Map<string, number>;
  driftCountByBucket: Map<string, number>;
  totalOpenCount: number;
  committedCount: number;
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
  committedCount,
  canEdit,
  onCreateBucket,
  onRenameBucket,
  onDeleteBucket,
}: Props) {
  const [adding, setAdding] = useState(false);

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
            reserveAction={canEdit}
            onClick={() => onSelect("all")}
          />
          <SelectionRow
            icon={<Sunrise className="size-4" aria-hidden />}
            label="Today"
            count={committedCount}
            active={selection === "today"}
            reserveAction={canEdit}
            onClick={() => onSelect("today")}
          />
          {inbox ? (
            <SelectionRow
              icon={<Inbox className="size-4" aria-hidden />}
              label="Inbox"
              count={openCountByBucket.get(inbox.id) ?? 0}
              drift={driftCountByBucket.get(inbox.id) ?? 0}
              active={selection === "inbox" || selection === inbox.id}
              reserveAction={canEdit}
              onClick={() => onSelect("inbox")}
            />
          ) : null}

          {/* Buckets section header — hover reveals a "+" (Notion-style add). */}
          <div className="group/sec mt-3 mb-1 flex items-center justify-between">
            <span className={SECTION_LABEL}>Buckets</span>
            {canEdit ? (
              <button
                type="button"
                aria-label="New bucket"
                onClick={() => setAdding(true)}
                className="mr-1 flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/sec:opacity-100"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {adding ? (
            <BucketAddInput onCreate={onCreateBucket} onClose={() => setAdding(false)} />
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
      className="flex shrink-0 gap-1 rounded-md bg-muted p-1"
    >
      {(["plan", "execute"] as const).map((value) => (
        <button
          key={value}
          role="tab"
          aria-selected={mode === value}
          onClick={() => onModeChange(value)}
          // flex-1 fills width (uniform p-1 inset all around); inner radius =
          // outer (rounded-md) minus p-1 → rounded-sm, so corners nest cleanly.
          className={cn(
            "flex-1 rounded-sm py-1 text-center font-display text-sm capitalize transition-colors",
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

// ── meta (counts + drift) — secondary font, numbers only ──────────────────────

function CountDrift({ count, drift }: { count: number; drift?: number }) {
  const hasDrift = !!drift && drift > 0;
  if (count === 0 && !hasDrift) return null;
  // X (Y): X = open count, Y = drifted (parenthesised). Word lives in the tooltip.
  const body = (
    <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground/70">
      {count}
      {hasDrift ? <span className="text-muted-foreground/50"> ({drift})</span> : null}
    </span>
  );
  if (!hasDrift) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent>
        {count} open · {drift} drifted
      </TooltipContent>
    </Tooltip>
  );
}

// ── rows ──────────────────────────────────────────────────────────────────────

function SelectionRow({
  icon,
  label,
  count,
  drift,
  active,
  reserveAction,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  drift?: number;
  active: boolean;
  /** Reserve a trailing slot so counts align with bucket rows' hover "…". */
  reserveAction?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-display">{label}</span>
      </button>
      <CountDrift count={count} drift={drift} />
      {reserveAction ? <span className="size-5 shrink-0" aria-hidden /> : null}
    </div>
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
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={() => canEdit && setRenaming(true)}
        className="flex min-w-0 flex-1 items-center text-left focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate font-display">{bucket.name}</span>
      </button>
      <CountDrift count={count} drift={drift} />
      {canEdit ? (
        // reserves its slot always (no layout shift); just fades in on hover
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${bucket.name} options`}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
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

function BucketAddInput({
  onCreate,
  onClose,
}: {
  onCreate: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = (keepOpen: boolean) => {
    const name = value.trim();
    if (name) onCreate(name);
    setValue("");
    if (keepOpen) ref.current?.focus();
    else onClose();
  };

  return (
    <div className="px-1 py-0.5">
      <Input
        ref={ref}
        value={value}
        placeholder="Bucket name — Enter to add"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(true); // instant, keep open for rapid adds
          else if (e.key === "Escape") {
            setValue("");
            onClose();
          }
        }}
        onBlur={() => commit(false)}
        className="h-7 px-1.5 py-0 text-sm"
      />
    </div>
  );
}
