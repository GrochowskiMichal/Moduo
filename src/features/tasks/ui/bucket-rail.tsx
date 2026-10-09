import { useDndMonitor } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Inbox, Layers, ListChecks, Plus, Trash2, UserRound } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import type { LabelColor } from "../../../components/tag-colors";
import { Input } from "../../../components/ui/input";
import {
  focusNavRow,
  type MenuKit,
  NavRow,
  NavRowDot,
  NavSectionHeader,
  restoreNavFocus,
} from "../../../components/ui/nav-row";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { ShareMenu } from "../../sharing/share-menu";
import { TIME_BLOCK_LABELS, TIME_BLOCK_SLOTS, type TimeBlockSlot } from "../default-view";
import { bucketSections } from "../helpers";
import type { Bucket } from "../model";
import { BUCKET_COLOR_OPTIONS, bucketDotColor } from "../sidebar";
import { DeleteBucketDialog } from "./delete-bucket-dialog";

export type TasksMode = "plan" | "execute";

/** The rail's selection for Recently deleted (TV-U6). */
export const TRASH_SELECTION = "trash";

// Bucket rows are sortable inside the page's one DndContext (DF-22). Their ids
// carry the `rail:` prefix TV-U4's rail drop targets share, so the page's
// collision keeps them apart from the center views' droppables.
export const RAIL_BUCKET_PREFIX = "rail:bucket:";
type RailBucketDrag = { type: "rail-bucket"; bucketId: string };
const railBucketDrag = (bucketId: string): RailBucketDrag => ({ type: "rail-bucket", bucketId });

/** The bucket a rail drag (or its drop target) is about, or null. */
export function asRailBucket(data: unknown): string | null {
  return data && typeof data === "object" && (data as { type?: unknown }).type === "rail-bucket"
    ? (data as RailBucketDrag).bucketId
    : null;
}

type Props = {
  mode: TasksMode;
  onModeChange: (mode: TasksMode) => void;
  selection: string; // "all" | "today" | "mine" | "inbox" | "trash" | bucketId
  onSelect: (selection: string) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  /** Archived buckets (TV-U6): a collapsed section at the bottom while there are any. */
  archivedBuckets?: Bucket[];
  /** Items in Recently deleted (TV-U6): its row shows while there are any. */
  trashCount?: number;
  openCountByBucket: Map<string, number>;
  /** Tasks each bucket's list shows (open + done) — quoted by the delete confirm. */
  taskCountByBucket: Map<string, number>;
  driftCountByBucket: Map<string, number>;
  totalOpenCount: number;
  /** My open queued tasks (my personal queue, TV-D4). */
  queueCount: number;
  /** My open assigned tasks; null hides "My tasks" (fewer than two members). */
  myTasksCount: number | null;
  canEdit: boolean;
  onCreateBucket: (name: string) => void;
  onRenameBucket: (id: string, name: string) => void;
  /** Confirmed in the rail's dialog: move the tasks to Inbox, or delete them too. */
  onDeleteBucket: (id: string, withTasks: boolean) => void;
  onArchiveBucket?: (id: string) => void;
  onUnarchiveBucket?: (id: string) => void;
  onSetBucketColor?: (id: string, color: LabelColor) => void;
  /** A bucket dragged onto another one (TV-U6); rows are sortable only with it. */
  onMoveBucket?: (activeId: string, overId: string) => void;
  /** A bucket's hover "+": capture a task straight into it. */
  onCaptureInto?: (bucketId: string) => void;
  /** Open batch-triage for a bucket's drifted tasks. */
  onTriageBucket: (bucketId: string) => void;
  /** Which time-block slot (if any) each bucket is mapped to. */
  timeBlockByBucket: Map<string, TimeBlockSlot>;
  /** Assign a bucket to a slot, or clear it (slot = null). */
  onSetTimeBlock: (bucketId: string, slot: TimeBlockSlot | null) => void;
  /** Assign a bucket to a presentational section, or clear it (group = null). */
  onSetBucketGroup: (bucketId: string, group: string | null) => void;
  /** Collapsed section names (remembered per workspace by the page). */
  collapsedSections: ReadonlySet<string>;
  onToggleSection: (name: string) => void;
  /** Whether Archived is expanded (collapsed by default; remembered by the page). */
  archivedOpen?: boolean;
  onToggleArchived?: () => void;
  /**
   * The rail's <nav>, for the page to hand focus back to it when a dialog the
   * rail opened (triage) closes; see `focusNavRow`.
   */
  navRef?: RefObject<HTMLElement | null>;
};

/** Collapsed section names from storage; anything unreadable is "none collapsed". */
export function parseCollapsedSections(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((v): v is string => typeof v === "string" && v.trim() !== ""));
  } catch {
    return new Set();
  }
}

export function BucketRail({
  mode,
  onModeChange,
  selection,
  onSelect,
  buckets,
  inbox,
  archivedBuckets = [],
  trashCount = 0,
  openCountByBucket,
  taskCountByBucket,
  driftCountByBucket,
  totalOpenCount,
  queueCount,
  myTasksCount,
  canEdit,
  onCreateBucket,
  onRenameBucket,
  onDeleteBucket,
  onArchiveBucket,
  onUnarchiveBucket,
  onSetBucketColor,
  onMoveBucket,
  onCaptureInto,
  onTriageBucket,
  timeBlockByBucket,
  onSetTimeBlock,
  onSetBucketGroup,
  collapsedSections,
  onToggleSection,
  archivedOpen = false,
  onToggleArchived,
  navRef,
}: Props) {
  const ownNavRef = useRef<HTMLElement | null>(null);
  const nav = navRef ?? ownNavRef;
  const [adding, setAdding] = useState(false);
  // Delete asks first (Q1-4). Bucket + counts are snapshotted on open: confirming
  // empties the bucket at once, and the closing dialog must keep its copy.
  const [deleting, setDeleting] = useState<{
    bucket: Bucket;
    taskCount: number;
    openCount: number;
    open: boolean;
  } | null>(null);
  const requestDelete = (bucket: Bucket) =>
    setDeleting({
      bucket,
      taskCount: taskCountByBucket.get(bucket.id) ?? 0,
      openCount: openCountByBucket.get(bucket.id) ?? 0,
      open: true,
    });
  // A dialog or popover a row's menu opened has no trigger to hand focus back
  // to, so it lands on the rail: the row itself if it survived (Cancel), else
  // the current row (a confirmed delete). Not when focus already moved on.
  const returnFocus = (bucketId: string | null) => (event: Event) =>
    restoreNavFocus(event, nav.current, bucketId);
  // An inline input closed by Enter/Esc unmounts with focus in it; the row it
  // belongs to renders on the next commit.
  const focusRowSoon = (bucketId: string | null) =>
    setTimeout(() => focusNavRow(nav.current, bucketId), 0);

  const { ungrouped, sections } = bucketSections(buckets);
  const groupNames = sections.map((s) => s.name);
  const inboxDrift = inbox ? (driftCountByBucket.get(inbox.id) ?? 0) : 0;
  // Drag to reorder needs edit access; the rows stay plain otherwise.
  const sortable = canEdit && !!onMoveBucket;

  const bucketRow = (bucket: Bucket) => {
    const row = (drag?: DragSlot) => (
      <BucketRow
        bucket={bucket}
        count={openCountByBucket.get(bucket.id) ?? 0}
        drift={driftCountByBucket.get(bucket.id) ?? 0}
        current={selection === bucket.id}
        canEdit={canEdit}
        timeBlock={timeBlockByBucket.get(bucket.id) ?? null}
        groupNames={groupNames}
        onSelect={() => onSelect(bucket.id)}
        onRename={(name) => onRenameBucket(bucket.id, name)}
        onDelete={() => requestDelete(bucket)}
        onArchive={onArchiveBucket ? () => onArchiveBucket(bucket.id) : undefined}
        onSetColor={onSetBucketColor ? (color) => onSetBucketColor(bucket.id, color) : undefined}
        onCapture={canEdit && onCaptureInto ? () => onCaptureInto(bucket.id) : undefined}
        onTriage={() => onTriageBucket(bucket.id)}
        onSetTimeBlock={(slot) => onSetTimeBlock(bucket.id, slot)}
        onSetGroup={(group) => onSetBucketGroup(bucket.id, group)}
        onShareCloseAutoFocus={returnFocus(bucket.id)}
        onInputExit={() => focusRowSoon(bucket.id)}
        drag={drag}
      />
    );
    return sortable ? (
      <SortableBucket key={bucket.id} bucketId={bucket.id}>
        {row}
      </SortableBucket>
    ) : (
      <div key={bucket.id}>{row()}</div>
    );
  };
  // One sortable list per section: a drop on another section's bucket moves
  // the dragged one into that section (bucketDropPatch).
  const sortableList = (list: Bucket[]) =>
    sortable ? (
      <SortableContext
        items={list.map((b) => `${RAIL_BUCKET_PREFIX}${b.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {list.map(bucketRow)}
      </SortableContext>
    ) : (
      list.map(bucketRow)
    );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ModeToggle mode={mode} onModeChange={onModeChange} />

      <div className="pane-scroll min-h-0 flex-1 overflow-auto">
        <nav ref={nav} className="flex flex-col gap-px" aria-label="Buckets">
          <NavRow
            label="All"
            icon={<Layers aria-hidden />}
            count={totalOpenCount}
            countLabel={`${totalOpenCount} open`}
            current={selection === "all"}
            onSelect={() => onSelect("all")}
          />
          <NavRow
            label="Queue"
            icon={<ListChecks aria-hidden />}
            count={queueCount}
            countLabel={`${queueCount} queued`}
            current={selection === "today"}
            onSelect={() => onSelect("today")}
          />
          {myTasksCount !== null ? (
            <NavRow
              label="My tasks"
              icon={<UserRound aria-hidden />}
              count={myTasksCount}
              countLabel={`${myTasksCount} open`}
              current={selection === "mine"}
              onSelect={() => onSelect("mine")}
            />
          ) : null}
          {inbox ? (
            <NavRow
              navId={inbox.id}
              label="Inbox"
              icon={<Inbox aria-hidden />}
              count={openCountByBucket.get(inbox.id) ?? 0}
              countLabel={`${openCountByBucket.get(inbox.id) ?? 0} open`}
              current={selection === "inbox" || selection === inbox.id}
              onSelect={() => onSelect("inbox")}
              indicator={
                inboxDrift > 0 ? (
                  <DriftMark
                    label={`${inboxDrift} drifted · triage`}
                    onTriage={() => onTriageBucket(inbox.id)}
                  />
                ) : undefined
              }
              menu={
                canEdit && inboxDrift > 0
                  ? (m) => (
                      <m.Item onSelect={m.afterClose(() => onTriageBucket(inbox.id))}>
                        Triage {inboxDrift} drifted…
                      </m.Item>
                    )
                  : undefined
              }
            />
          ) : null}

          <NavSectionHeader
            className="mt-3"
            label="Buckets"
            onAdd={canEdit ? () => setAdding(true) : undefined}
            addLabel="New bucket"
          />

          {adding ? (
            <BucketAddInput
              onCreate={onCreateBucket}
              onClose={() => setAdding(false)}
              onKeyExit={() => focusRowSoon(null)}
            />
          ) : null}

          {sortable && onMoveBucket ? <BucketDndMonitor onMove={onMoveBucket} /> : null}

          {/* Ungrouped buckets render flat, first. */}
          {sortableList(ungrouped)}

          {/* Collapsible sections (two levels max: section → bucket). */}
          {sections.map((section) => {
            const collapsed = collapsedSections.has(section.name);
            const openCount = section.buckets.reduce(
              (n, b) => n + (openCountByBucket.get(b.id) ?? 0),
              0,
            );
            // Aggregate drift so a collapsed section still surfaces it ambiently
            // (the per-bucket marks are hidden while collapsed).
            const driftCount = section.buckets.reduce(
              (n, b) => n + (driftCountByBucket.get(b.id) ?? 0),
              0,
            );
            return (
              <div key={section.name} className="mt-2 flex flex-col gap-px">
                <NavSectionHeader
                  label={section.name}
                  count={openCount}
                  countLabel={`${openCount} open`}
                  collapsed={collapsed}
                  onToggle={() => onToggleSection(section.name)}
                  indicator={
                    collapsed && driftCount > 0 ? (
                      <DriftMark
                        label={`${driftCount} drifted in ${section.name} · expand to triage`}
                      />
                    ) : undefined
                  }
                />
                {!collapsed ? sortableList(section.buckets) : null}
              </div>
            );
          })}

          {/* Archived (TV-U6): collapsed by default, only while there are any. */}
          {archivedBuckets.length > 0 ? (
            <div className="mt-3 flex flex-col gap-px">
              <NavSectionHeader
                label="Archived"
                collapsed={!archivedOpen}
                onToggle={onToggleArchived}
              />
              {archivedOpen
                ? archivedBuckets.map((bucket) => (
                    <ArchivedBucketRow
                      key={bucket.id}
                      bucket={bucket}
                      current={selection === bucket.id}
                      canEdit={canEdit}
                      onSelect={() => onSelect(bucket.id)}
                      onUnarchive={
                        onUnarchiveBucket ? () => onUnarchiveBucket(bucket.id) : undefined
                      }
                      onDelete={() => requestDelete(bucket)}
                    />
                  ))
                : null}
            </div>
          ) : null}

          {/* Recently deleted (TV-U6): last and quiet, only while it holds anything. */}
          {trashCount > 0 ? (
            <NavRow
              className="mt-3"
              navId={TRASH_SELECTION}
              label="Recently deleted"
              icon={<Trash2 aria-hidden />}
              count={trashCount}
              countLabel={trashCount === 1 ? "1 item" : `${trashCount} items`}
              current={selection === TRASH_SELECTION}
              onSelect={() => onSelect(TRASH_SELECTION)}
            />
          ) : null}
        </nav>
      </div>

      <DeleteBucketDialog
        bucket={deleting?.bucket ?? null}
        open={deleting?.open ?? false}
        taskCount={deleting?.taskCount ?? 0}
        openCount={deleting?.openCount ?? 0}
        onConfirm={(bucket, withTasks) => onDeleteBucket(bucket.id, withTasks)}
        onClose={() => setDeleting((prev) => (prev ? { ...prev, open: false } : prev))}
        onCloseAutoFocus={returnFocus(deleting?.bucket.id ?? null)}
      />
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
  // Shared SegmentedControl primitive. The internal mode value stays "execute"
  // (model-level); the label reads "Focus". TV-F2 removes the switch.
  return (
    <SegmentedControl
      aria-label="Tasks mode"
      fullWidth
      value={mode}
      onValueChange={(value) => onModeChange(value as TasksMode)}
      items={[
        { value: "plan", label: "Plan" },
        { value: "execute", label: "Focus" },
      ]}
    />
  );
}

// ── drift mark ────────────────────────────────────────────────────────────────

/**
 * Drift is ambient: a quiet dot before the count, never red (tasks-v2 T7). It
 * sits outside the count's slot, so it stays put while the count swaps for ⋯
 * and a click on it still opens triage.
 */
function DriftMark({ label, onTriage }: { label: string; onTriage?: () => void }) {
  const dot = <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onTriage ? (
          <button
            type="button"
            aria-label={label}
            onClick={onTriage}
            className="flex size-4 items-center justify-center rounded-sm outline-none hover:bg-state-active focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {dot}
          </button>
        ) : (
          <span role="img" aria-label={label} className="flex size-4 items-center justify-center">
            {dot}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ── bucket row ────────────────────────────────────────────────────────────────

/** What a sortable wrapper hands its row. */
type DragSlot = { isDragging: boolean };

/**
 * A bucket row you can drag to reorder (TV-U6). The whole row is the
 * activator (a 6 px pointer move starts the drag, so a click still selects it)
 * and the only keyboard activator, so Space/Enter on its own buttons never
 * lift it (the TV-Q1 rule): rows aren't focusable, so there is no keyboard lift.
 */
function SortableBucket({
  bucketId,
  children,
}: {
  bucketId: string;
  children: (drag: DragSlot) => ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: `${RAIL_BUCKET_PREFIX}${bucketId}`, data: railBucketDrag(bucketId) });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        setActivatorNodeRef(el);
      }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10" : undefined}
      {...listeners}
    >
      {children({ isDragging })}
    </div>
  );
}

/** Commits a bucket drop: inside the page's DndContext, it reacts only to rail buckets. */
function BucketDndMonitor({ onMove }: { onMove: (activeId: string, overId: string) => void }) {
  useDndMonitor({
    onDragEnd: (event) => {
      const active = asRailBucket(event.active.data.current);
      const over = asRailBucket(event.over?.data.current);
      if (active && over && active !== over) onMove(active, over);
    },
  });
  return null;
}

function BucketRow({
  bucket,
  count,
  drift,
  current,
  canEdit,
  timeBlock,
  groupNames,
  onSelect,
  onRename,
  onDelete,
  onArchive,
  onSetColor,
  onCapture,
  onTriage,
  onSetTimeBlock,
  onSetGroup,
  onShareCloseAutoFocus,
  onInputExit,
  drag,
}: {
  bucket: Bucket;
  count: number;
  drift: number;
  current: boolean;
  canEdit: boolean;
  timeBlock: TimeBlockSlot | null;
  groupNames: string[];
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onArchive?: () => void;
  onSetColor?: (color: LabelColor) => void;
  /** The hover "+": capture straight into this bucket. */
  onCapture?: () => void;
  onTriage: () => void;
  onSetTimeBlock: (slot: TimeBlockSlot | null) => void;
  onSetGroup: (group: string | null) => void;
  onShareCloseAutoFocus: (event: Event) => void;
  /** The New section input closed by Enter/Esc: focus goes back to the row. */
  onInputExit: () => void;
  drag?: DragSlot;
}) {
  const [sharing, setSharing] = useState(false);
  const [addingSection, setAddingSection] = useState(false);

  if (addingSection) {
    return (
      <SectionNameInput
        onCommit={(name) => {
          if (name) onSetGroup(name);
          setAddingSection(false);
        }}
        onCancel={() => setAddingSection(false)}
        onKeyExit={onInputExit}
      />
    );
  }

  // tasks-v2 §11: Rename · Colour · Open at · Section · Share · Archive · Delete…
  const dot = bucketDotColor(bucket);
  const menu = (m: MenuKit) => (
    <>
      <m.Item onSelect={m.rename}>Rename</m.Item>
      {onSetColor ? (
        <m.Sub>
          <m.SubTrigger>Colour</m.SubTrigger>
          <m.SubContent>
            <m.RadioGroup value={dot} onValueChange={(v) => onSetColor(v as LabelColor)}>
              {BUCKET_COLOR_OPTIONS.map((option) => (
                <m.RadioItem key={option.value} value={option.value}>
                  <NavRowDot color={option.value} />
                  {option.label}
                </m.RadioItem>
              ))}
            </m.RadioGroup>
          </m.SubContent>
        </m.Sub>
      ) : null}
      <m.Sub>
        <m.SubTrigger>Open at</m.SubTrigger>
        <m.SubContent>
          <m.RadioGroup
            value={timeBlock ?? "none"}
            onValueChange={(v) => onSetTimeBlock(v === "none" ? null : (v as TimeBlockSlot))}
          >
            <m.RadioItem value="none">No default</m.RadioItem>
            {TIME_BLOCK_SLOTS.map((slot) => (
              <m.RadioItem key={slot} value={slot}>
                {TIME_BLOCK_LABELS[slot]}
              </m.RadioItem>
            ))}
          </m.RadioGroup>
        </m.SubContent>
      </m.Sub>
      <m.Sub>
        <m.SubTrigger>Section</m.SubTrigger>
        <m.SubContent>
          <m.RadioGroup
            value={bucket.group ?? "none"}
            onValueChange={(v) => onSetGroup(v === "none" ? null : v)}
          >
            <m.RadioItem value="none">No section</m.RadioItem>
            {groupNames.map((name) => (
              <m.RadioItem key={name} value={name}>
                {name}
              </m.RadioItem>
            ))}
          </m.RadioGroup>
          <m.Separator />
          <m.Item onSelect={m.afterClose(() => setAddingSection(true))}>
            <Plus aria-hidden />
            New section…
          </m.Item>
        </m.SubContent>
      </m.Sub>
      {!bucket.isSystem ? (
        <m.Item onSelect={m.afterClose(() => setSharing(true))}>Share</m.Item>
      ) : null}
      {drift > 0 ? (
        <m.Item onSelect={m.afterClose(onTriage)}>Triage {drift} drifted…</m.Item>
      ) : null}
      {!bucket.isSystem ? (
        <>
          <m.Separator />
          {onArchive ? <m.Item onSelect={onArchive}>Archive</m.Item> : null}
          <m.Item variant="destructive" onSelect={m.afterClose(onDelete)}>
            Delete bucket…
          </m.Item>
        </>
      ) : null}
    </>
  );

  return (
    // Positioned so the Share popover can anchor to the row.
    <div className="relative">
      <NavRow
        navId={bucket.id}
        label={bucket.name}
        icon={<NavRowDot color={dot} />}
        count={count}
        countLabel={`${count} open`}
        current={current}
        onSelect={onSelect}
        indicator={
          drift > 0 ? (
            <DriftMark label={`${drift} drifted · triage`} onTriage={onTriage} />
          ) : undefined
        }
        onRename={canEdit ? onRename : undefined}
        menu={canEdit ? menu : undefined}
        onAdd={onCapture}
        addLabel={`New task in ${bucket.name}`}
        dragging={drag?.isDragging}
      />
      {sharing && !bucket.isSystem ? (
        <BucketShare
          bucketId={bucket.id}
          onClose={() => setSharing(false)}
          onCloseAutoFocus={onShareCloseAutoFocus}
        />
      ) : null}
    </div>
  );
}

/**
 * A bucket under Archived (TV-U6): opens its tasks read-only; ⋯ is Unarchive
 * and Delete. No count: nothing in it is on anyone's list.
 */
function ArchivedBucketRow({
  bucket,
  current,
  canEdit,
  onSelect,
  onUnarchive,
  onDelete,
}: {
  bucket: Bucket;
  current: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
}) {
  return (
    <NavRow
      navId={bucket.id}
      label={bucket.name}
      icon={<NavRowDot color={bucketDotColor(bucket)} />}
      current={current}
      onSelect={onSelect}
      menu={
        canEdit
          ? (m) => (
              <>
                {onUnarchive ? <m.Item onSelect={onUnarchive}>Unarchive</m.Item> : null}
                <m.Item variant="destructive" onSelect={m.afterClose(onDelete)}>
                  Delete bucket…
                </m.Item>
              </>
            )
          : undefined
      }
    />
  );
}

/** The Share popover, opened from the row menu and anchored to the row. */
function BucketShare({
  bucketId,
  onClose,
  onCloseAutoFocus,
}: {
  bucketId: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { userId } = useAuth();
  const { members } = useWorkspace();
  return (
    <ShareMenu
      defaultOpen
      anchor="parent"
      onOpenChange={(open) => !open && onClose()}
      onCloseAutoFocus={onCloseAutoFocus}
      resourceType="bucket"
      resourceId={bucketId}
      selfUserId={userId}
      members={members
        .filter((m) => m.isActive && !m.removedAt)
        .map((m) => ({ userId: m.userId, name: m.displayName?.trim() || "Member" }))}
    />
  );
}

// ── add bucket (instant, no cooldown) ─────────────────────────────────────────

function BucketAddInput({
  onCreate,
  onClose,
  onKeyExit,
}: {
  onCreate: (name: string) => void;
  onClose: () => void;
  /** Esc closed it: focus goes back to the rail (a blur already moved it). */
  onKeyExit: () => void;
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
        size="sm"
        value={value}
        placeholder="Bucket name — Enter to add"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter")
            commit(true); // instant, keep open for rapid adds
          else if (e.key === "Escape") {
            setValue("");
            onClose();
            onKeyExit();
          }
        }}
        onBlur={() => commit(false)}
        className="px-1.5"
      />
    </div>
  );
}

// ── new section (inline; assigns the bucket to a fresh section) ────────────────

function SectionNameInput({
  onCommit,
  onCancel,
  onKeyExit,
}: {
  onCommit: (name: string) => void;
  onCancel: () => void;
  /** Enter/Esc closed it (a blur already moved focus elsewhere). */
  onKeyExit: () => void;
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
    <div className="px-1 py-0.5">
      <Input
        ref={ref}
        size="sm"
        value={value}
        placeholder="Section name — Enter"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            onKeyExit();
          } else if (e.key === "Escape") {
            committed.current = true;
            onCancel();
            onKeyExit();
          }
        }}
        onBlur={commit}
        className="px-1.5"
      />
    </div>
  );
}
