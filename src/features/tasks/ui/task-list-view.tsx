import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { cn } from "../../../lib/utils";
import { groupTasks, type GroupBy } from "../helpers";
import type { Bucket, Task } from "../model";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { TaskRow, type RowCommand } from "./task-row";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "inbox" | bucketId
  groupBy: GroupBy;
  onGroupByChange: (next: GroupBy) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  canEdit: boolean;
  onRequestCapture: () => void;
  api: TasksModuleApi;
};

const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: "none", label: "None" },
  { value: "status", label: "Status" },
  { value: "bucket", label: "Bucket" },
  { value: "priority", label: "Priority" },
  { value: "energy", label: "Energy" },
];

export function TaskListView({
  tasks,
  scopeTitle,
  selection,
  groupBy,
  onGroupByChange,
  buckets,
  inbox,
  bucketNameById,
  canEdit,
  onRequestCapture,
  api,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [command, setCommand] = useState<{ taskId: string; kind: RowCommand } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const isAll = selection === "all";
  const showBucketTag = isAll || groupBy === "status" || groupBy === "priority" || groupBy === "energy";

  const groups = useMemo(
    () => groupTasks(tasks, groupBy, { bucketName: bucketNameById }),
    [tasks, groupBy, bucketNameById],
  );

  // Reset collapse state when the scope/grouping changes. For bucket grouping,
  // open one group by default (per the "one open by default" rule); otherwise
  // everything is expanded.
  const groupSignature = `${selection}:${groupBy}:${groups.map((g) => g.key).join(",")}`;
  const initRef = useRef("");
  useEffect(() => {
    if (initRef.current === groupSignature) return;
    initRef.current = groupSignature;
    if (groupBy === "bucket" && groups.length > 1) {
      setCollapsed(new Set(groups.slice(1).map((g) => g.key)));
    } else {
      setCollapsed(new Set());
    }
  }, [groupSignature, groupBy, groups]);

  // Flat, visually-ordered list of navigable tasks (skips collapsed groups).
  const visibleTasks = useMemo(
    () => groups.filter((g) => !collapsed.has(g.key)).flatMap((g) => g.tasks),
    [groups, collapsed],
  );

  // Keep the selection valid as tasks change.
  useEffect(() => {
    if (selectedId && visibleTasks.some((t) => t.id === selectedId)) return;
    setSelectedId(visibleTasks[0]?.id ?? null);
  }, [visibleTasks, selectedId]);

  // Keyboard-first: focus the list once on mount so j/k work immediately —
  // unless focus is already somewhere intentional (an input, an open dialog).
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) containerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (visibleTasks.length === 0) return;
      const idx = visibleTasks.findIndex((t) => t.id === selectedId);
      const nextIdx = idx < 0 ? 0 : Math.min(visibleTasks.length - 1, Math.max(0, idx + delta));
      setSelectedId(visibleTasks[nextIdx]?.id ?? null);
    },
    [visibleTasks, selectedId],
  );

  const selectedTask = visibleTasks.find((t) => t.id === selectedId) ?? null;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // While inline-editing a title, the Input stops propagation; popovers are
      // portaled out — so reaching here means plain navigation is safe.
      if (editingId) return;
      const key = e.key.toLowerCase();
      if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (key === "x" || e.key === " ") {
        if (!selectedTask || !canEdit) return;
        e.preventDefault();
        api.toggleDone(selectedTask);
      } else if (key === "enter" || key === "e") {
        if (!selectedTask || !canEdit) return;
        e.preventDefault();
        setEditingId(selectedTask.id);
      } else if (key === "c") {
        e.preventDefault();
        onRequestCapture();
      } else if (key === "b" && selectedTask && canEdit) {
        e.preventDefault();
        setCommand({ taskId: selectedTask.id, kind: "bucket" });
      } else if (key === "s" && selectedTask && canEdit) {
        e.preventDefault();
        setCommand({ taskId: selectedTask.id, kind: "schedule" });
      } else if (key === "d" && selectedTask && canEdit) {
        e.preventDefault();
        setCommand({ taskId: selectedTask.id, kind: "due" });
      } else if ((e.metaKey || e.ctrlKey) && (e.key === "Backspace" || e.key === "Delete")) {
        if (!selectedTask || !canEdit) return;
        e.preventDefault();
        api.deleteTask(selectedTask.id);
      }
    },
    [editingId, move, selectedTask, canEdit, api, onRequestCapture],
  );

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h1 className="truncate font-display text-lg text-foreground">{scopeTitle}</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Group</span>
            <Select value={groupBy} onValueChange={(v) => onGroupByChange(v as GroupBy)}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={onRequestCapture} disabled={!canEdit}>
            <Plus className="size-4" aria-hidden />
            New task
          </Button>
        </div>
      </div>

      {/* list */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="grid"
        aria-label={`${scopeTitle} tasks`}
        className="min-h-0 flex-1 overflow-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {tasks.length === 0 ? (
          <EmptyState canEdit={canEdit} onRequestCapture={onRequestCapture} />
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key} className="mb-1">
                {groupBy !== "none" ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5" aria-hidden />
                    ) : (
                      <ChevronDown className="size-3.5" aria-hidden />
                    )}
                    <span className="uppercase tracking-wide">{group.label}</span>
                    <span className="text-muted-foreground/70">{group.tasks.length}</span>
                  </button>
                ) : null}

                {!isCollapsed
                  ? group.tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        bucketName={bucketNameById(task.bucketId)}
                        buckets={buckets}
                        inboxId={inbox?.id ?? null}
                        showBucket={showBucketTag}
                        selected={task.id === selectedId}
                        editing={task.id === editingId}
                        command={command?.taskId === task.id ? command.kind : null}
                        canEdit={canEdit}
                        onSelect={() => setSelectedId(task.id)}
                        onStartEdit={() => setEditingId(task.id)}
                        onEndEdit={() => {
                          setEditingId(null);
                          containerRef.current?.focus();
                        }}
                        onClearCommand={() => {
                          setCommand(null);
                          containerRef.current?.focus();
                        }}
                        onRequestCommand={(kind) => setCommand({ taskId: task.id, kind })}
                        api={api}
                      />
                    ))
                  : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyState({
  canEdit,
  onRequestCapture,
}: {
  canEdit: boolean;
  onRequestCapture: () => void;
}) {
  return (
    <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
      <p className="text-sm">Nothing here yet.</p>
      {canEdit ? (
        <Button variant="secondary" size="sm" onClick={onRequestCapture} className="mx-auto">
          <Plus className="size-4" aria-hidden />
          Add a task
        </Button>
      ) : null}
    </div>
  );
}
