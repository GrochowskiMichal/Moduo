import { Inbox, Layers, ListChecks, Plus, UserRound } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
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
import { DeleteBucketDialog } from "./delete-bucket-dialog";

export type TasksMode = "plan" | "execute";

type Props = {
  mode: TasksMode;
  onModeChange: (mode: TasksMode) => void;
  selection: string; // "all" | "today" | "mine" | "inbox" | bucketId
  onSelect: (selection: string) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
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
  onDeleteBucket: (id: string) => void;
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
  onTriageBucket,
  timeBlockByBucket,
  onSetTimeBlock,
  onSetBucketGroup,
  collapsedSections,
  onToggleSection,
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

  const bucketRow = (bucket: Bucket) => (
    <BucketRow
      key={bucket.id}
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
      onTriage={() => onTriageBucket(bucket.id)}
      onSetTimeBlock={(slot) => onSetTimeBlock(bucket.id, slot)}
      onSetGroup={(group) => onSetBucketGroup(bucket.id, group)}
      onShareCloseAutoFocus={returnFocus(bucket.id)}
      onInputExit={() => focusRowSoon(bucket.id)}
    />
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

          {/* Ungrouped buckets render flat, first. */}
          {ungrouped.map(bucketRow)}

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
                {!collapsed ? section.buckets.map(bucketRow) : null}
              </div>
            );
          })}
        </nav>
      </div>

      <DeleteBucketDialog
        bucket={deleting?.bucket ?? null}
        open={deleting?.open ?? false}
        taskCount={deleting?.taskCount ?? 0}
        openCount={deleting?.openCount ?? 0}
        onConfirm={(bucket) => onDeleteBucket(bucket.id)}
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
  onTriage,
  onSetTimeBlock,
  onSetGroup,
  onShareCloseAutoFocus,
  onInputExit,
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
  onTriage: () => void;
  onSetTimeBlock: (slot: TimeBlockSlot | null) => void;
  onSetGroup: (group: string | null) => void;
  onShareCloseAutoFocus: (event: Event) => void;
  /** The New section input closed by Enter/Esc: focus goes back to the row. */
  onInputExit: () => void;
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

  const menu = (m: MenuKit) => (
    <>
      <m.Item onSelect={m.rename}>Rename</m.Item>
      {!bucket.isSystem ? (
        <m.Item onSelect={m.afterClose(() => setSharing(true))}>Share</m.Item>
      ) : null}
      {drift > 0 ? (
        <m.Item onSelect={m.afterClose(onTriage)}>Triage {drift} drifted…</m.Item>
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
        <>
          <m.Separator />
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
        icon={<NavRowDot />}
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
