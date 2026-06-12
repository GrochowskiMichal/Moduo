import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Inbox,
  Layers,
  MoreHorizontal,
  Plus,
  Sunrise,
} from "lucide-react";

import { Input } from "../../../components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import {
  TIME_BLOCK_LABELS,
  TIME_BLOCK_SLOTS,
  type TimeBlockSlot,
} from "../default-view";
import { bucketSections } from "../helpers";
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
  /** Open batch-triage for a bucket's drifted tasks. */
  onTriageBucket: (bucketId: string) => void;
  /** Which time-block slot (if any) each bucket is mapped to. */
  timeBlockByBucket: Map<string, TimeBlockSlot>;
  /** Assign a bucket to a slot, or clear it (slot = null). */
  onSetTimeBlock: (bucketId: string, slot: TimeBlockSlot | null) => void;
  /** Assign a bucket to a presentational section, or clear it (group = null). */
  onSetBucketGroup: (bucketId: string, group: string | null) => void;
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
  onTriageBucket,
  timeBlockByBucket,
  onSetTimeBlock,
  onSetBucketGroup,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const { ungrouped, sections } = bucketSections(buckets);
  const groupNames = sections.map((s) => s.name);
  const toggleSection = (name: string) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

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
              onTriage={() => onTriageBucket(inbox.id)}
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

          {/* Ungrouped buckets render flat, first. */}
          {ungrouped.map((bucket) => (
            <BucketRow
              key={bucket.id}
              bucket={bucket}
              count={openCountByBucket.get(bucket.id) ?? 0}
              drift={driftCountByBucket.get(bucket.id) ?? 0}
              active={selection === bucket.id}
              canEdit={canEdit}
              timeBlock={timeBlockByBucket.get(bucket.id) ?? null}
              groupNames={groupNames}
              onClick={() => onSelect(bucket.id)}
              onRename={(name) => onRenameBucket(bucket.id, name)}
              onDelete={() => onDeleteBucket(bucket.id)}
              onTriage={() => onTriageBucket(bucket.id)}
              onSetTimeBlock={(slot) => onSetTimeBlock(bucket.id, slot)}
              onSetGroup={(group) => onSetBucketGroup(bucket.id, group)}
            />
          ))}

          {/* Collapsible sections (two levels max: section → bucket). */}
          {sections.map((section) => {
            const collapsed = collapsedSections.has(section.name);
            const openCount = section.buckets.reduce(
              (n, b) => n + (openCountByBucket.get(b.id) ?? 0),
              0,
            );
            return (
              <div key={section.name} className="mt-2">
                <button
                  type="button"
                  onClick={() => toggleSection(section.name)}
                  aria-expanded={!collapsed}
                  className="group/sec flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-muted-foreground hover:text-foreground"
                >
                  {collapsed ? (
                    <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate font-display text-2xs font-medium uppercase tracking-wide">
                    {section.name}
                  </span>
                  <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground/60">
                    {openCount}
                  </span>
                </button>
                {!collapsed
                  ? section.buckets.map((bucket) => (
                      <BucketRow
                        key={bucket.id}
                        bucket={bucket}
                        count={openCountByBucket.get(bucket.id) ?? 0}
                        drift={driftCountByBucket.get(bucket.id) ?? 0}
                        active={selection === bucket.id}
                        canEdit={canEdit}
                        timeBlock={timeBlockByBucket.get(bucket.id) ?? null}
                        groupNames={groupNames}
                        onClick={() => onSelect(bucket.id)}
                        onRename={(name) => onRenameBucket(bucket.id, name)}
                        onDelete={() => onDeleteBucket(bucket.id)}
                        onTriage={() => onTriageBucket(bucket.id)}
                        onSetTimeBlock={(slot) => onSetTimeBlock(bucket.id, slot)}
                        onSetGroup={(group) => onSetBucketGroup(bucket.id, group)}
                      />
                    ))
                  : null}
              </div>
            );
          })}
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

function CountDrift({
  count,
  drift,
  onTriage,
}: {
  count: number;
  drift?: number;
  /** Clicking the drift number opens batch-triage. */
  onTriage?: () => void;
}) {
  const hasDrift = !!drift && drift > 0;
  if (count === 0 && !hasDrift) return null;
  // X (Y): X = open count, Y = drifted (parenthesised, click to triage). The
  // word "drifted" lives in the tooltip — the rail itself stays numbers-only.
  if (!hasDrift) {
    return (
      <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground/70">
        {count}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center font-sans text-xs tabular-nums text-muted-foreground/70">
      {count}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Triage ${drift} drifted`}
            onClick={(e) => {
              e.stopPropagation();
              onTriage?.();
            }}
            className="ml-0.5 rounded px-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          >
            ({drift})
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {count} open · {drift} drifted — click to triage
        </TooltipContent>
      </Tooltip>
    </span>
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
  onTriage,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  drift?: number;
  active: boolean;
  /** Reserve a trailing slot so counts align with bucket rows' hover "…". */
  reserveAction?: boolean;
  onClick: () => void;
  onTriage?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-0.5 text-sm",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      style={{ minHeight: "var(--row-h)" }}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-display">{label}</span>
      </button>
      <CountDrift count={count} drift={drift} onTriage={onTriage} />
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
  timeBlock,
  groupNames,
  onClick,
  onRename,
  onDelete,
  onTriage,
  onSetTimeBlock,
  onSetGroup,
}: {
  bucket: Bucket;
  count: number;
  drift: number;
  active: boolean;
  canEdit: boolean;
  timeBlock: TimeBlockSlot | null;
  groupNames: string[];
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onTriage: () => void;
  onSetTimeBlock: (slot: TimeBlockSlot | null) => void;
  onSetGroup: (group: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
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

  if (addingSection) {
    return (
      <SectionNameInput
        onCommit={(name) => {
          if (name) onSetGroup(name);
          setAddingSection(false);
        }}
        onCancel={() => setAddingSection(false)}
      />
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-0.5 text-sm",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      style={{ minHeight: "var(--row-h)" }}
    >
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={() => canEdit && setRenaming(true)}
        className="flex min-w-0 flex-1 items-center text-left focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate font-display">{bucket.name}</span>
      </button>
      <CountDrift count={count} drift={drift} onTriage={onTriage} />
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
            {drift > 0 ? (
              <DropdownMenuItem onSelect={onTriage}>Triage {drift} drifted…</DropdownMenuItem>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Open at</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={timeBlock ?? "none"}
                  onValueChange={(v) =>
                    onSetTimeBlock(v === "none" ? null : (v as TimeBlockSlot))
                  }
                >
                  <DropdownMenuRadioItem value="none">No default</DropdownMenuRadioItem>
                  {TIME_BLOCK_SLOTS.map((slot) => (
                    <DropdownMenuRadioItem key={slot} value={slot}>
                      {TIME_BLOCK_LABELS[slot]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Section</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={bucket.group ?? "none"}
                  onValueChange={(v) => onSetGroup(v === "none" ? null : v)}
                >
                  <DropdownMenuRadioItem value="none">No section</DropdownMenuRadioItem>
                  {groupNames.map((name) => (
                    <DropdownMenuRadioItem key={name} value={name}>
                      {name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAddingSection(true)}>
                  <Plus className="size-4" aria-hidden />
                  New section…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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

// ── new section (inline; assigns the bucket to a fresh section) ────────────────

function SectionNameInput({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(value.trim());
  };

  return (
    <div className="px-2 py-0.5">
      <Input
        ref={ref}
        value={value}
        placeholder="Section name — Enter"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            committed.current = true;
            onCancel();
          }
        }}
        onBlur={commit}
        className="h-7 px-1.5 py-0 text-sm"
      />
    </div>
  );
}
