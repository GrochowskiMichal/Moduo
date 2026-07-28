/**
 * TaskLinePlugin (Wave-3 NO-5, AC3/AC4) — the companion to TaskLineNode.
 *
 * Owns everything around the editable title text:
 *  - checkbox + right-side meta rendered in an OVERLAY outside the
 *    contenteditable, absolutely positioned over each line (Lexical's
 *    mutation observer reclaims foreign DOM inside its root — portals into
 *    node DOM crash + loop; the playground draggable-block pattern instead);
 *  - two-way sync: line text → debounced task rename OUT; task title/done →
 *    line IN (edit-gated, skipped while the caret sits in that line);
 *  - convert gestures: hover "Make task" on plain checkbox lines, a
 *    right-click menu, and ⌘⇧T (single line + batch selection);
 *  - detach flows: deleting lines (any gesture) soft-detaches with ONE
 *    undoable toast via the bridge; menu Detach-keep/Detach-delete; ⌘Z right
 *    after a mint fully reverts (task deleted too — never orphaned).
 *
 * Programmatic edits carry the `moduo-task-line` update tag so the deletion
 * detector never mistakes our own conversions for user deletions; remote
 * (collaboration) updates are ignored outright — the deleting client owns the
 * gesture and its toast.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $addUpdateTag,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COLLABORATION_TAG,
  HISTORIC_TAG,
  HISTORY_MERGE_TAG,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
} from "@lexical/list";
import { CalendarClock, CheckSquare, ExternalLink, Trash2, Unlink, X } from "lucide-react";
import { CompleteToggle } from "@/components/ui/complete-toggle";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateField } from "@/components/ui/date-field";
import { formatDue, formatScheduled } from "@/features/tasks/helpers";
import type { Task } from "@/features/tasks/model";
import { useNotesEditorBridge, type NotesTaskBridge } from "../notes-editor-bridge";
import {
  $createTaskLineNode,
  $isTaskLineNode,
  TaskLineNode,
} from "../nodes/task-line-node";
import type { TaskLineSnapshot } from "../../tasks/detach";

/** Our own programmatic updates — the deletion detector skips these. */
export const TASK_LINE_TAG = "moduo-task-line";

const RENAME_DEBOUNCE_MS = 500;

type LineEntry = {
  taskId: string | null;
  text: string;
  done: boolean;
  rootIndex: number;
  /** Overlay geometry, relative to the scroll container's content origin.
   * The line element's identity matters too: the collab binding can recreate
   * a node's DOM at any time, and geometry follows the LIVE element. */
  element: HTMLElement | null;
  top: number;
  height: number;
  left: number;
  right: number;
};

// ── document walking ─────────────────────────────────────────────────────────

type LineData = Pick<LineEntry, "taskId" | "text" | "done" | "rootIndex">;

function $collectTaskLines(): Map<NodeKey, LineData> {
  const map = new Map<NodeKey, LineData>();
  const root = $getRoot();
  const rootChildren = root.getChildren();
  const visit = (node: LexicalNode, rootIndex: number) => {
    if ($isTaskLineNode(node)) {
      map.set(node.getKey(), {
        taskId: node.getTaskId(),
        text: node.getTextContent(),
        done: node.getDone(),
        rootIndex,
      });
      return; // task lines never nest
    }
    if ($isElementNode(node)) {
      for (const child of (node as ElementNode).getChildren()) visit(child, rootIndex);
    }
  };
  rootChildren.forEach((child, index) => visit(child, index));
  return map;
}

/** The checklist items covered by the current selection (the ⌘⇧T targets). */
function $selectedChecklistItemKeys(): NodeKey[] {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return [];
  const keys = new Set<NodeKey>();
  const ordered: NodeKey[] = [];
  for (const node of selection.getNodes()) {
    let cur: LexicalNode | null = node;
    while (cur && !$isListItemNode(cur)) cur = cur.getParent();
    if (!cur) continue;
    const list = cur.getParent();
    if (!$isListNode(list) || list.getListType() !== "check") continue;
    if (!keys.has(cur.getKey())) {
      keys.add(cur.getKey());
      ordered.push(cur.getKey());
    }
  }
  return ordered;
}

/** Replace a checklist item with a PENDING task line carrying its text. */
function $convertItemToPendingLine(item: ListItemNode): NodeKey {
  const list = item.getParent();
  const line = $createTaskLineNode(null, false);
  for (const child of item.getChildren()) line.append(child);

  if ($isListNode(list)) {
    // Insert while the list is still ATTACHED — removing a list's last item
    // self-destructs the list (Lexical), and inserting after a detached node
    // throws. Order: place the line (splitting if needed), THEN remove.
    const items = list.getChildren();
    const index = items.indexOf(item);
    const after = items.slice(index + 1).filter($isListItemNode);
    if (after.length === 0) {
      list.insertAfter(line);
    } else {
      // Split the list so document order survives the extraction.
      const tail = $createListNode("check");
      for (const it of after) tail.append(it);
      list.insertAfter(tail);
      tail.insertBefore(line);
    }
    item.remove(); // an emptied list removes itself
  } else {
    item.replace(line);
  }
  return line.getKey();
}

/** Turn a task line back into a humble checkbox line (detach gestures). */
function $convertLineToChecklist(line: TaskLineNode): NodeKey {
  const list = $createListNode("check");
  const item = $createListItemNode(line.getDone());
  for (const child of line.getChildren()) item.append(child);
  list.append(item);
  line.replace(list);
  return item.getKey();
}

/** Re-insert detached lines at their captured top-level indexes (toast Undo). */
function $restoreLines(lines: TaskLineSnapshot[], tasksById: Map<string, Task | null>) {
  const root = $getRoot();
  for (const snap of [...lines].sort((a, b) => a.rootIndex - b.rootIndex)) {
    const task = tasksById.get(snap.taskId) ?? null;
    const line = $createTaskLineNode(snap.taskId, task ? task.status === "done" : snap.done);
    line.append($createTextNode(task?.title ?? snap.title));
    const children = root.getChildren();
    const at = Math.min(Math.max(snap.rootIndex, 0), children.length);
    if (at >= children.length) root.append(line);
    else children[at]!.insertBefore(line);
  }
}

// ── mint helpers (shared by /task create and the convert gestures) ──────────

/**
 * Stamp a freshly minted task onto a pending line. If the line vanished while
 * the create was in flight, the caller must revert the mint (no orphan task).
 * Returns whether the stamp landed.
 */
export function stampMintedTask(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  task: Task,
): boolean {
  // The editor unmounted while the create was in flight (note switch): the
  // detached state would still "accept" the stamp but it never reaches the
  // persisted doc — report not-landed so the caller reverts the mint
  // (validator M4). The reopened doc's orphaned pending line is degraded by
  // the plugin's mount sweep.
  if (editor.getRootElement() === null) return false;
  let landed = false;
  editor.update(
    () => {
      // Fold the stamp into the SAME undo step as the insert/convert — ⌘Z
      // must revert the whole mint (destroying a line that still carries its
      // taskId, so the revert plan can delete the task too), never strand a
      // pending line with no task behind it.
      $addUpdateTag(HISTORY_MERGE_TAG);
      const node = $getNodeByKey(nodeKey);
      if ($isTaskLineNode(node)) {
        node.setTaskId(task.id);
        node.setDone(task.status === "done");
        landed = true;
      }
    },
    { tag: TASK_LINE_TAG },
  );
  return landed;
}

/** Degrade a failed mint back to a plain checkbox line (title kept). */
export function degradePendingLine(editor: LexicalEditor, nodeKey: NodeKey): void {
  editor.update(
    () => {
      const node = $getNodeByKey(nodeKey);
      if ($isTaskLineNode(node)) $convertLineToChecklist(node);
    },
    { tag: TASK_LINE_TAG },
  );
}

/** Mint tasks for checklist item keys (⌘⇧T / hover / menu — single + batch). */
export function convertChecklistItems(
  editor: LexicalEditor,
  tasks: NotesTaskBridge,
  itemKeys: NodeKey[],
): void {
  if (!tasks.canEditTasks || itemKeys.length === 0) return;
  const pending: { lineKey: NodeKey; title: string }[] = [];
  editor.update(
    () => {
      for (const key of itemKeys) {
        const item = $getNodeByKey(key);
        if (!$isListItemNode(item)) continue;
        const title = item.getTextContent().trim();
        const lineKey = $convertItemToPendingLine(item);
        pending.push({ lineKey, title });
      }
    },
    { tag: TASK_LINE_TAG },
  );
  // Sequential on purpose: parallel mints compute the same Inbox tail
  // position from the same stale bundle (ambiguous ordering) and stack
  // redundant reloads (validator minor). Batches are small.
  void (async () => {
    for (const { lineKey, title } of pending) {
      const task = await tasks.mintTask(title);
      if (!task) {
        degradePendingLine(editor, lineKey);
        continue;
      }
      if (!stampMintedTask(editor, lineKey, task)) {
        // The line disappeared mid-mint — take the task back out.
        tasks.revertMintIfJustMinted(task.id);
      }
    }
  })();
}

// ── overlay widgets ──────────────────────────────────────────────────────────

function TaskLineCheckbox({
  entry,
  task,
  tasks,
  editable,
}: {
  entry: LineEntry;
  task: Task | null;
  tasks: NotesTaskBridge;
  editable: boolean;
}) {
  const pending = entry.taskId === null;
  const missing = !pending && task === null;
  const done = task ? task.status === "done" : entry.done;
  return (
    <CompleteToggle
      done={done}
      disabled={pending || missing || !editable || !tasks.canEditTasks}
      onToggle={() => {
        if (entry.taskId) tasks.toggleTask(entry.taskId);
      }}
      aria-label={done ? "Reopen task" : "Complete task"}
    />
  );
}

function TaskLineMeta({
  nodeKey,
  entry,
  task,
  tasks,
  editable,
  active,
  onDetachKeep,
  onDetachDelete,
  onRemoveLine,
}: {
  nodeKey: NodeKey;
  entry: LineEntry;
  task: Task | null;
  tasks: NotesTaskBridge;
  editable: boolean;
  /** The pointer is over this line — reveal the quiet actions. */
  active: boolean;
  onDetachKeep: (key: NodeKey) => void;
  onDetachDelete: (key: NodeKey) => void;
  onRemoveLine: (key: NodeKey) => void;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const pending = entry.taskId === null;
  const missing = !pending && task === null;

  if (pending) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title="Creating task…"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
      </span>
    );
  }

  if (missing) {
    // The task was deleted in Tasks — tombstone + a "remove line" affordance.
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="line-through">task deleted</span>
        {editable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-sm p-0.5 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove line"
                onClick={() => onRemoveLine(nodeKey)}
              >
                <X className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Remove line</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
    );
  }

  const dueLabel = formatDue(task!.dueDate);
  const scheduledLabel = formatScheduled(task!.scheduledAt);
  const chipLabel = scheduledLabel ?? dueLabel;
  const reveal = active || scheduleOpen;

  return (
    <Popover open={scheduleOpen} onOpenChange={setScheduleOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            className="inline-flex max-w-40 items-center gap-1 truncate rounded-sm bg-background/80 px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            title="Open task details"
            onClick={() => tasks.openTaskDetail(entry.taskId!)}
          >
            {chipLabel ?? "Details"}
          </button>
          {editable && tasks.canEditTasks ? (
            <span
              className={`inline-flex items-center gap-0.5 transition-opacity duration-(--motion-fast) ease-(--ease-out) focus-within:opacity-100 motion-reduce:transition-none ${
                reveal ? "opacity-100" : "opacity-0"
              }`}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Schedule task"
                    onClick={() => setScheduleOpen((v) => !v)}
                  >
                    <CalendarClock className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Schedule</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Detach task from this line"
                    onClick={() => onDetachKeep(nodeKey)}
                  >
                    <Unlink className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Detach, keep task</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Detach and delete task"
                    onClick={() => onDetachDelete(nodeKey)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Detach and delete task</TooltipContent>
              </Tooltip>
            </span>
          ) : null}
        </span>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-auto p-2">
        <DateField
          value={task!.scheduledAt ? new Date(task!.scheduledAt) : null}
          onChange={(d) => {
            tasks.scheduleTaskAt(entry.taskId!, d ? d.toISOString() : null);
            setScheduleOpen(false);
          }}
          withTime
          aria-label="Schedule task"
        />
      </PopoverContent>
    </Popover>
  );
}

// ── floating affordances ─────────────────────────────────────────────────────

type HoverState = { itemKey: NodeKey; top: number; left: number };
type MenuState = {
  kind: "checkbox" | "task-line";
  nodeKey: NodeKey;
  taskId: string | null;
  top: number;
  left: number;
};

// ── the plugin ───────────────────────────────────────────────────────────────

export function TaskLinePlugin({
  editable,
  noteId,
}: {
  editable: boolean;
  /** Pinned per editor instance — detach batches must bill THIS note even
   * when they flush after a note switch (validator minor). */
  noteId: string;
}) {
  const [editor] = useLexicalComposerContext();
  const bridge = useNotesEditorBridge();
  const tasks = bridge?.tasks ?? null;
  const noteIdRef = useRef(noteId);
  useEffect(() => {
    noteIdRef.current = noteId;
  });

  // Mount sweep: a PENDING line in a freshly opened doc is an orphan (its
  // mint either reverted or died with a previous session) — degrade it to a
  // humble checkbox rather than showing an eternal "Creating task…" dot.
  // Two-step so a THIS-session mint on a slow network is never swept: capture
  // the keys pending shortly after the doc bootstraps, degrade only those
  // still pending later — a fresh mint creates keys outside the captured set.
  useEffect(() => {
    if (!editable) return;
    let captured: NodeKey[] = [];
    const readPending = () =>
      editor
        .getEditorState()
        .read(() =>
          [...$collectTaskLines().entries()]
            .filter(([, e]) => e.taskId === null)
            .map(([key]) => key),
        );
    const captureId = setTimeout(() => {
      captured = readPending();
    }, 1500);
    const sweepId = setTimeout(() => {
      const still = new Set(readPending());
      for (const key of captured) {
        if (still.has(key)) degradePendingLine(editor, key);
      }
    }, 6000);
    return () => {
      clearTimeout(captureId);
      clearTimeout(sweepId);
    };
  }, [editor, editable]);

  const [entries, setEntries] = useState<Map<NodeKey, LineEntry>>(new Map());
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });

  // The overlay lives OUTSIDE the contenteditable, inside the scroll
  // container, so Lexical's mutation observer never sees (and reclaims) it.
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const rootEl = editor.getRootElement();
    const container = rootEl?.closest<HTMLElement>(".notes-editor-v2");
    if (!container) return;
    const el = document.createElement("div");
    el.setAttribute("data-task-line-overlay", "true");
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    container.appendChild(el);
    setOverlayEl(el);
    return () => {
      el.remove();
      setOverlayEl(null);
    };
  }, [editor]);

  const [hoveredLine, setHoveredLine] = useState<NodeKey | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  });

  // Per-task rename debouncers; while one is pending, sync-IN skips the title.
  const renameTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = renameTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // Detach batching — every destroyed line within the window joins ONE plan.
  const pendingDetach = useRef<Map<string, TaskLineSnapshot>>(new Map());
  const detachTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDetach = useCallback(() => {
    detachTimer.current = null;
    const t = tasksRef.current;
    const lines = [...pendingDetach.current.values()];
    pendingDetach.current = new Map();
    if (!t || lines.length === 0) return;
    t.detachTaskLines({
      noteId: noteIdRef.current,
      lines,
      mode: "toast",
      restoreLines: () =>
        editor.update(
          () => {
            const byId = new Map(lines.map((l) => [l.taskId, t.getTask(l.taskId)]));
            $restoreLines(lines, byId);
          },
          { tag: TASK_LINE_TAG },
        ),
    });
  }, [editor]);
  const flushDetachRef = useRef(flushDetach);
  useEffect(() => {
    flushDetachRef.current = flushDetach;
  });

  // Unmount with a batch still pending (fast note switch) → flush now so the
  // links still detach; the toast's undo becomes link-restore only.
  useEffect(
    () => () => {
      if (detachTimer.current) {
        clearTimeout(detachTimer.current);
        flushDetachRef.current();
      }
    },
    [],
  );

  /** Geometry of a line element relative to the overlay (scroll-content space). */
  const measure = useCallback(
    (el: HTMLElement | null): Pick<LineEntry, "top" | "height" | "left" | "right"> => {
      const container = overlayEl?.parentElement;
      if (!el || !container) return { top: 0, height: 0, left: 0, right: 0 };
      const cRect = container.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return {
        top: rect.top - cRect.top + container.scrollTop,
        height: rect.height,
        left: rect.left - cRect.left + container.scrollLeft,
        right: rect.right - cRect.left + container.scrollLeft,
      };
    },
    [overlayEl],
  );

  // Re-measure on container resize (fonts, panel drags, window).
  const [measureStamp, setMeasureStamp] = useState(0);
  useEffect(() => {
    const container = overlayEl?.parentElement;
    if (!container) return;
    const ro = new ResizeObserver(() => setMeasureStamp((s) => s + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, [overlayEl]);

  // ── the one document listener: track lines, renames OUT, deletions ────────
  useEffect(() => {
    const recompute = () => {
      const collected = editor.getEditorState().read($collectTaskLines);
      const prev = entriesRef.current;
      const next = new Map<NodeKey, LineEntry>();
      for (const [key, data] of collected) {
        const el = editor.getElementByKey(key);
        next.set(key, { ...data, element: el, ...measure(el) });
      }
      let changed = next.size !== prev.size;
      if (!changed) {
        for (const [key, entry] of next) {
          const before = prev.get(key);
          if (
            !before ||
            before.taskId !== entry.taskId ||
            before.text !== entry.text ||
            before.done !== entry.done ||
            before.rootIndex !== entry.rootIndex ||
            before.element !== entry.element ||
            before.top !== entry.top ||
            before.height !== entry.height ||
            before.left !== entry.left ||
            before.right !== entry.right
          ) {
            changed = true;
            break;
          }
        }
      }
      if (changed) setEntries(next);
      return next;
    };

    // Geometry-only refresh (resize).
    recompute();

    return editor.registerUpdateListener(({ editorState, tags }) => {
      const collected = editorState.read($collectTaskLines);
      const prev = entriesRef.current;

      const ourOwn = tags.has(TASK_LINE_TAG);
      const remote = tags.has(COLLABORATION_TAG);
      const historic = tags.has(HISTORIC_TAG);
      const t = tasksRef.current;

      if (t && !remote && !ourOwn) {
        // Rename OUT: local text edits → debounced task rename. The flush
        // reads the EDITED line's node key — with the same task on two lines,
        // "first entry wins" would send the untouched twin's text (validator
        // minor) and sync-IN would then revert the user's edit.
        for (const [key, entry] of collected) {
          const before = prev.get(key);
          if (!before || !entry.taskId || before.text === entry.text) continue;
          const taskId = entry.taskId;
          const timer = renameTimers.current.get(taskId);
          if (timer) clearTimeout(timer);
          renameTimers.current.set(
            taskId,
            setTimeout(() => {
              renameTimers.current.delete(taskId);
              const live = entriesRef.current.get(key);
              if (live?.taskId === taskId) t.renameTask(taskId, live.text);
            }, RENAME_DEBOUNCE_MS),
          );
        }

        // Deletions: lines gone from the doc.
        const restored: string[] = [];
        for (const [key, before] of prev) {
          if (collected.has(key) || !before.taskId) continue;
          if (historic && t.revertMintIfJustMinted(before.taskId)) continue;
          pendingDetach.current.set(before.taskId, {
            taskId: before.taskId,
            title: before.text.trim() || "Untitled task",
            done: before.done,
            rootIndex: before.rootIndex,
          });
        }
        // Historic re-creations (⌘Z of a deletion / redo) — re-link pending
        // detaches instead of leaving a dangling toast. A ⌘Z INSIDE the
        // 200ms batch window must also pull the line back OUT of the batch,
        // or the flush detaches a line that's visibly back (validator B1).
        if (historic) {
          for (const [key, entry] of collected) {
            if (!prev.has(key) && entry.taskId) restored.push(entry.taskId);
          }
          for (const taskId of restored) pendingDetach.current.delete(taskId);
          if (pendingDetach.current.size === 0 && detachTimer.current !== null) {
            clearTimeout(detachTimer.current);
            detachTimer.current = null;
          }
          if (restored.length > 0) t.restoreDetachedTasks(restored);
        }
        if (pendingDetach.current.size > 0 && detachTimer.current === null) {
          detachTimer.current = setTimeout(flushDetach, 200);
        }
      }

      recompute();
    });
  }, [editor, flushDetach, measure, measureStamp]);

  // ── sync IN: live task → line (done snapshot + title, edit-gated) ─────────
  useEffect(() => {
    if (!tasks || !editable) return;
    const fixes: { key: NodeKey; done?: boolean; title?: string }[] = [];
    for (const [key, entry] of entries) {
      if (!entry.taskId) continue;
      const task = tasks.getTask(entry.taskId);
      if (!task) continue;
      const done = task.status === "done";
      const fix: { key: NodeKey; done?: boolean; title?: string } = { key };
      if (done !== entry.done) fix.done = done;
      const lineTitle = entry.text.trim();
      if (task.title.trim() !== lineTitle && !renameTimers.current.has(entry.taskId)) {
        fix.title = task.title;
      }
      if (fix.done !== undefined || fix.title !== undefined) fixes.push(fix);
    }
    if (fixes.length === 0) return;
    editor.update(
      () => {
        // Reconciling remote task state must never become its own undo step.
        $addUpdateTag(HISTORY_MERGE_TAG);
        const selection = $getSelection();
        for (const fix of fixes) {
          const node = $getNodeByKey(fix.key);
          if (!$isTaskLineNode(node)) continue;
          if (fix.done !== undefined) node.setDone(fix.done);
          if (fix.title !== undefined) {
            // Plain-text replacement is intended: task titles are plain
            // strings, so a remote rename flattens any inline formatting the
            // line carried — the task is the source of truth for its name.
            // Never clobber a line the caret is editing.
            const caretInside =
              $isRangeSelection(selection) &&
              selection
                .getNodes()
                .some((n) => n.getKey() === fix.key || n.getParent()?.getKey() === fix.key);
            if (!caretInside) {
              node.clear();
              node.append($createTextNode(fix.title));
            }
          }
        }
      },
      { tag: TASK_LINE_TAG },
    );
  }, [editor, editable, tasks, entries]);

  // ── convert gestures ───────────────────────────────────────────────────────
  const convertSelection = useCallback(() => {
    const t = tasksRef.current;
    if (!t) return false;
    const keys = editor.getEditorState().read($selectedChecklistItemKeys);
    if (keys.length === 0) return false;
    convertChecklistItems(editor, t, keys);
    return true;
  }, [editor]);

  // ⌘⇧T on the editor root (single line or batch selection). Handlers are
  // defined ONCE per effect run — defining them inside the root-listener
  // callback makes prevRoot removal a no-op (fresh identity) and every
  // effect re-run stacks another live listener.
  useEffect(() => {
    if (!editable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "t"
      ) {
        if (convertSelection()) event.preventDefault();
      }
    };
    const teardown = editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener("keydown", onKeyDown);
      root?.addEventListener("keydown", onKeyDown);
    });
    return () => {
      editor.getRootElement()?.removeEventListener("keydown", onKeyDown);
      teardown();
    };
  }, [editor, editable, convertSelection]);

  // Hover tracking: reveal a line's quiet actions + the "Make task" pill on
  // plain checkbox lines. The pill is fixed-positioned off the line's rect —
  // any scroll dismisses it (stale coordinates must never invite a mis-click).
  useEffect(() => {
    const onScroll = () => setHover(null);
    const onOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const lineEl = target?.closest<HTMLElement>("[data-task-line]");
      if (lineEl) {
        const key = getNearestNodeKey(editor, lineEl);
        setHoveredLine(key);
        setHover(null);
        return;
      }
      setHoveredLine(null);
      if (!editable) return;
      const li = target?.closest<HTMLElement>(
        ".notes-list-item-unchecked, .notes-list-item-checked",
      );
      if (!li) {
        setHover(null);
        return;
      }
      const key = getNearestNodeKey(editor, li);
      if (!key) return setHover(null);
      const rect = li.getBoundingClientRect();
      setHover({ itemKey: key, top: rect.top, left: rect.right + 8 });
    };
    const onLeave = () => {
      setHover(null);
      setHoveredLine(null);
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const teardown = editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener("mouseover", onOver);
      prevRoot?.removeEventListener("mouseleave", onLeave);
      root?.addEventListener("mouseover", onOver);
      root?.addEventListener("mouseleave", onLeave);
    });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      const root = editor.getRootElement();
      root?.removeEventListener("mouseover", onOver);
      root?.removeEventListener("mouseleave", onLeave);
      teardown();
    };
  }, [editor, editable]);

  // Right-click menu on checkbox lines + task lines.
  useEffect(() => {
    if (!editable) return;
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const lineEl = target?.closest<HTMLElement>("[data-task-line]");
      const li = lineEl
        ? null
        : target?.closest<HTMLElement>(
            ".notes-list-item-unchecked, .notes-list-item-checked",
          );
      if (!lineEl && !li) return;
      const key = getNearestNodeKey(editor, lineEl ?? li!);
      if (!key) return;
      event.preventDefault();
      setHover(null);
      setMenu({
        kind: lineEl ? "task-line" : "checkbox",
        nodeKey: key,
        taskId: lineEl ? (lineEl.getAttribute("data-task-id") ?? null) : null,
        top: event.clientY,
        left: event.clientX,
      });
    };
    const teardown = editor.registerRootListener((root, prevRoot) => {
      prevRoot?.removeEventListener("contextmenu", onContextMenu);
      root?.addEventListener("contextmenu", onContextMenu);
    });
    return () => {
      editor.getRootElement()?.removeEventListener("contextmenu", onContextMenu);
      teardown();
    };
  }, [editor, editable]);

  // Menu dismissal: click-away + Escape.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [menu]);

  // ── detach actions (meta buttons + menu) ───────────────────────────────────
  const detachKeep = useCallback(
    (nodeKey: NodeKey) => {
      const t = tasksRef.current;
      const entry = entriesRef.current.get(nodeKey);
      if (!t || !entry?.taskId) return;
      editor.update(
        () => {
          const node = $getNodeByKey(nodeKey);
          if ($isTaskLineNode(node)) $convertLineToChecklist(node);
        },
        { tag: TASK_LINE_TAG },
      );
      t.detachTaskLines({
        noteId: noteIdRef.current,
        lines: [
          {
            taskId: entry.taskId,
            title: entry.text.trim() || "Untitled task",
            done: entry.done,
            rootIndex: entry.rootIndex,
          },
        ],
        mode: "keep",
        restoreLines: () => {},
      });
    },
    [editor],
  );

  const detachDelete = useCallback(
    (nodeKey: NodeKey) => {
      const t = tasksRef.current;
      const entry = entriesRef.current.get(nodeKey);
      if (!t || !entry?.taskId) return;
      const snapshot: TaskLineSnapshot = {
        taskId: entry.taskId,
        title: entry.text.trim() || "Untitled task",
        done: entry.done,
        rootIndex: entry.rootIndex,
      };
      let checkboxKey: NodeKey | null = null;
      editor.update(
        () => {
          const node = $getNodeByKey(nodeKey);
          if ($isTaskLineNode(node)) checkboxKey = $convertLineToChecklist(node);
        },
        { tag: TASK_LINE_TAG },
      );
      t.detachAndDeleteTask({
        noteId: noteIdRef.current,
        line: snapshot,
        restoreLine: () =>
          editor.update(
            () => {
              // Best effort: convert the checkbox line back if it still exists.
              if (checkboxKey) {
                const item = $getNodeByKey(checkboxKey);
                if ($isListItemNode(item)) {
                  const line = $createTaskLineNode(snapshot.taskId, snapshot.done);
                  for (const child of item.getChildren()) line.append(child);
                  const list = item.getParent();
                  if ($isListNode(list) && list.getChildrenSize() === 1) {
                    list.replace(line);
                  } else {
                    item.replace(line);
                  }
                  return;
                }
              }
              $restoreLines([snapshot], new Map([[snapshot.taskId, null]]));
            },
            { tag: TASK_LINE_TAG },
          ),
      });
    },
    [editor],
  );

  const removeLine = useCallback(
    (nodeKey: NodeKey) => {
      editor.update(
        () => {
          const node = $getNodeByKey(nodeKey);
          if ($isTaskLineNode(node)) node.remove();
        },
        { tag: TASK_LINE_TAG },
      );
    },
    [editor],
  );

  if (!tasks) return null;

  // ── render: one overlay portal with per-line widgets ───────────────────────
  const overlay =
    overlayEl &&
    createPortal(
      <>
        {[...entries.entries()].map(([key, entry]) => {
          if (!entry.element || entry.height === 0) return null;
          const task = entry.taskId ? tasks.getTask(entry.taskId) : null;
          return (
            <div key={key}>
              <span
                className="absolute inline-flex items-center"
                style={{
                  top: entry.top + 2,
                  left: entry.left + 4,
                  height: Math.min(entry.height, 28),
                  pointerEvents: "auto",
                }}
              >
                <TaskLineCheckbox entry={entry} task={task} tasks={tasks} editable={editable} />
              </span>
              <span
                className="absolute inline-flex items-center justify-end"
                style={{
                  top: entry.top + 2,
                  left: Math.max(entry.left, entry.right - 320),
                  width: Math.min(entry.right - entry.left, 320),
                  height: Math.min(entry.height, 28),
                  pointerEvents: "none",
                }}
              >
                <span style={{ pointerEvents: "auto" }}>
                  <TaskLineMeta
                    nodeKey={key}
                    entry={entry}
                    task={task}
                    tasks={tasks}
                    editable={editable}
                    active={hoveredLine === key}
                    onDetachKeep={detachKeep}
                    onDetachDelete={detachDelete}
                    onRemoveLine={removeLine}
                  />
                </span>
              </span>
            </div>
          );
        })}
      </>,
      overlayEl,
    );

  return (
    <>
      {overlay}
      {hover && editable && tasks.canEditTasks
        ? createPortal(
            <button
              type="button"
              className="fixed z-40 inline-flex items-center gap-1 rounded-md border border-border bg-popover px-1.5 py-0.5 text-xs text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              style={{ top: hover.top, left: hover.left }}
              onMouseDown={(e) => {
                e.preventDefault();
                const t = tasksRef.current;
                if (t) convertChecklistItems(editor, t, [hover.itemKey]);
                setHover(null);
              }}
            >
              <CheckSquare className="size-3" />
              Make task
            </button>,
            document.body,
          )
        : null}
      {menu
        ? createPortal(
            // Deliberately NOT the shadcn/Radix ContextMenu: its trigger model
            // wraps a React-owned element, but these targets are Lexical-owned
            // DOM inside the contenteditable (same constraint as the slash
            // menu, which uses this exact portal pattern). Keyboard users
            // reach every action through the focusable meta buttons.
            <div
              ref={menuRef}
              className="fixed z-50 min-w-48 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ top: menu.top, left: menu.left }}
              role="menu"
            >
              {menu.kind === "checkbox" ? (
                <ContextMenuItem
                  icon={CheckSquare}
                  label="Make task"
                  shortcut="⌘⇧T"
                  onSelect={() => {
                    const t = tasksRef.current;
                    if (t) convertChecklistItems(editor, t, [menu.nodeKey]);
                    setMenu(null);
                  }}
                />
              ) : (
                <>
                  <ContextMenuItem
                    icon={ExternalLink}
                    label="Open task details"
                    onSelect={() => {
                      if (menu.taskId) tasks.openTaskDetail(menu.taskId);
                      setMenu(null);
                    }}
                  />
                  <ContextMenuItem
                    icon={Unlink}
                    label="Detach, keep task"
                    onSelect={() => {
                      detachKeep(menu.nodeKey);
                      setMenu(null);
                    }}
                  />
                  <ContextMenuItem
                    icon={Trash2}
                    label="Detach and delete task"
                    destructive
                    onSelect={() => {
                      detachDelete(menu.nodeKey);
                      setMenu(null);
                    }}
                  />
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ContextMenuItem({
  icon: Icon,
  label,
  shortcut,
  destructive = false,
  onSelect,
}: {
  icon: typeof CheckSquare;
  label: string;
  shortcut?: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${
        destructive ? "text-destructive" : "text-foreground"
      }`}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      {shortcut ? <span className="text-xs text-muted-foreground/70">{shortcut}</span> : null}
    </button>
  );
}

/** The node key owning a DOM element. Must be `editor.read` (not
 * `editorState.read`) — `$getNearestNodeFromDOMNode` resolves the per-editor
 * `__lexicalKey_<editorKey>` DOM property, which needs the ACTIVE editor. */
function getNearestNodeKey(editor: LexicalEditor, el: HTMLElement): NodeKey | null {
  return editor.read(() => {
    const node = $getNearestNodeFromDOMNode(el);
    return node ? node.getKey() : null;
  });
}
