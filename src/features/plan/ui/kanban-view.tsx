import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task, TaskRelationKind, TaskWorkflowState } from "../../tasks/types";
import { priorityVisual, statusVisual } from "../../tasks/ui/task-visuals";
import { KanbanTaskContextModal } from "./kanban-task-context-modal";

function taskKey(id: string) { return `task:${id}`; }
function stateKey(id: string) { return `state:${id}`; }
function parseTaskId(id: string) { return id.startsWith("task:") ? id.slice(5) : null; }
function parseStateId(id: string) { return id.startsWith("state:") ? id.slice(6) : null; }
function PriorityLabel({ label }: { label: string }) {
  if (!label.startsWith("P") || label === "Nulla") return <>{label}</>;
  return <>P<span className="priority-roman-numeral">{label.slice(1)}</span></>;
}

function KanbanCard({
  task,
  selected,
  onSelect,
  onOpenContextMenu,
  assignee,
  labelColors,
  relationBadges,
}: {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  onOpenContextMenu: (taskId: string, x: number, y: number) => void;
  assignee: { label: string; avatarUrl: string | null; initial: string } | null;
  labelColors: Map<string, string>;
  relationBadges: Array<{ key: string; icon: string; value: number | null; color: string; title: string }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: taskKey(task.id),
    transition: { duration: 170, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  });
  const pv = priorityVisual(task.priority);

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
        boxShadow: isDragging ? "0 10px 24px rgba(0,0,0,0.35)" : undefined,
      }}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu(task.id, event.clientX, event.clientY);
      }}
      className={`group w-full rounded-xl border px-3 py-2.5 text-left transition-all cursor-grab active:cursor-grabbing ${selected ? "border-[#272727] bg-[#161616]" : "border-[#191919] bg-[#111] hover:bg-[#151515] hover:border-[#222] hover:-translate-y-px"}`}
    >
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1 text-[11px] font-medium text-[#ddd] truncate">{task.title || "Untitled"}</div>
            <span className="text-[10px] font-semibold shrink-0" style={{ color: pv.color }}>
              <PriorityLabel label={pv.label} />
            </span>
          </div>
          {!!task.description && <div className="text-[9px] text-[#666] mt-1 line-clamp-2">{task.description}</div>}
          {!!task.tags?.length && (
            <div className="mt-1 flex flex-wrap gap-1">
              {task.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded border text-[8px]"
                  style={{
                    borderColor: `${labelColors.get(tag) ?? "#232323"}66`,
                    background: `${labelColors.get(tag) ?? "#1a1a1a"}22`,
                    color: labelColors.get(tag) ?? "#909090",
                  }}
                >
                  {tag}
                </span>
              ))}
              {task.tags.length > 3 && <span className="text-[8px] text-[#555]">+{task.tags.length - 3}</span>}
            </div>
          )}
          {relationBadges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {relationBadges.map((badge) => (
                <span key={badge.key} title={badge.title} className="px-1.5 py-0.5 rounded border border-[#252525] bg-[#141414] text-[8px] font-semibold" style={{ color: badge.color }}>
                  {badge.icon}{badge.value !== null ? ` ${badge.value}` : ""}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            {task.dueDate && <div className="text-[9px] text-[#444]">{new Date(`${task.dueDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>}
            {assignee && (
              <div className="ml-auto h-5 w-5 rounded-full border border-[#2c2c2c] bg-[#1a1a1a] overflow-hidden grid place-items-center">
                {assignee.avatarUrl ? (
                  <img src={assignee.avatarUrl} alt={assignee.label} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[8px] font-bold text-[#bdbdbd]">{assignee.initial}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function KanbanColumn({
  state,
  count,
  taskIds,
  taskById,
  selectedTaskId,
  canEdit,
  onRequestCreateTask,
  onSelectTask,
  onOpenTaskContextMenu,
  assigneeById,
  isOver,
  projectLabelColorsByProjectId,
  relationMetaByTaskId,
}: {
  state: TaskWorkflowState;
  count: number;
  taskIds: string[];
  taskById: Map<string, Task>;
  selectedTaskId: string | null;
  canEdit: boolean;
  onRequestCreateTask: (stateId: string) => void;
  onSelectTask: (id: string) => void;
  onOpenTaskContextMenu: (taskId: string, x: number, y: number) => void;
  assigneeById: Map<string, { label: string; avatarUrl: string | null; initial: string }>;
  isOver: boolean;
  projectLabelColorsByProjectId: Map<string, Map<string, string>>;
  relationMetaByTaskId: Map<string, { childCount: number; blockingCount: number }>;
}) {
  const sv = statusVisual(state.kind, state.color, state.icon);
  const { setNodeRef: dropRef } = useDroppable({ id: stateKey(state.id) });

  return (
    <div className="shrink-0 w-64 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <span className="text-[11px]" style={{ color: sv.color }}>{sv.icon}</span>
        <span className="text-[11px] font-semibold text-[#ccc]">{state.name}</span>
        <span className="text-[10px] text-[#333] ml-0.5">{count}</span>
        {canEdit && (
          <button onClick={() => onRequestCreateTask(state.id)} className="ml-auto h-5 w-5 grid place-items-center rounded text-[#2a2a2a] hover:text-[#666] hover:bg-[#1a1a1a] transition-colors">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        )}
      </div>
      <div ref={dropRef} className={`flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto rounded-xl transition-all ${isOver ? "bg-[#131313] border border-[#242424] p-1.5" : ""}`}>
        <SortableContext items={taskIds.map(taskKey)} strategy={verticalListSortingStrategy}>
          {taskIds.map((id) => {
            const t = taskById.get(id);
            if (!t) return null;
            return (
              <KanbanCard
                key={t.id}
                task={t}
                selected={selectedTaskId === t.id}
                onSelect={() => onSelectTask(t.id)}
                onOpenContextMenu={onOpenTaskContextMenu}
                assignee={t.assigneeId ? (assigneeById.get(t.assigneeId) ?? null) : null}
                labelColors={projectLabelColorsByProjectId.get(t.projectId) ?? new Map<string, string>()}
                relationBadges={[
                  ...(t.childOfTaskId ? [{ key: "child_of", icon: "↳", value: null, color: "#9b9b9b", title: "Child of another task" }] : []),
                  ...((relationMetaByTaskId.get(t.id)?.childCount ?? 0) > 0 ? [{ key: "parent_of", icon: "⬑", value: relationMetaByTaskId.get(t.id)?.childCount ?? 0, color: "#9b9b9b", title: "Parent of tasks" }] : []),
                  ...((t.blockedByTaskIds?.length ?? 0) > 0 ? [{ key: "blocked_by", icon: "⛔", value: t.blockedByTaskIds.length, color: "#d88c8c", title: "Blocked by tasks" }] : []),
                  ...((relationMetaByTaskId.get(t.id)?.blockingCount ?? 0) > 0 ? [{ key: "blocking", icon: "⛓", value: relationMetaByTaskId.get(t.id)?.blockingCount ?? 0, color: "#8ca6d8", title: "Blocking tasks" }] : []),
                  ...(t.duplicateOfTaskId ? [{ key: "duplicate_of", icon: "⧉", value: null, color: "#b49bd9", title: "Duplicate of another task" }] : []),
                ]}
              />
            );
          })}
        </SortableContext>
        {!taskIds.length && <div className="flex-1 min-h-[48px] border border-dashed border-[#161616] rounded-xl grid place-items-center text-[9px] text-[#1e1e1e]">Drop here</div>}
      </div>
    </div>
  );
}

export function KanbanView({
  states,
  tasks,
  selectedTaskId,
  projectId,
  onSelectTask,
  onMoveTask,
  onRequestCreateTask,
  assigneeById,
  assigneeOptions,
  canEdit,
  projectLabelColorsByProjectId,
  projectLabelsByProjectId,
  onQuickUpdateTask,
  onRenameTask,
  onDuplicateTask,
  onDeleteTask,
  onApplyRelation,
}: {
  states: TaskWorkflowState[];
  tasks: Task[];
  selectedTaskId: string | null;
  projectId: string | null;
  onSelectTask: (id: string) => void;
  onMoveTask: (taskId: string, stateId: string, beforeTaskId: string | null) => void;
  onRequestCreateTask: (stateId: string) => void;
  assigneeById: Map<string, { label: string; avatarUrl: string | null; initial: string }>;
  assigneeOptions: Array<{ id: string; label: string; avatarUrl: string | null; initial: string }>;
  canEdit: boolean;
  projectLabelColorsByProjectId: Map<string, Map<string, string>>;
  projectLabelsByProjectId: Map<string, Array<{ name: string; color: string }>>;
  onQuickUpdateTask: (taskId: string, patch: Partial<Pick<Task, "priority" | "assigneeId" | "tags">>) => Promise<void>;
  onRenameTask: (taskId: string, title: string) => Promise<void>;
  onDuplicateTask: (task: Task) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onApplyRelation: (sourceTaskId: string, kind: TaskRelationKind, targetTaskId: string) => Promise<string | null>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const filteredStates = states.filter((s) => !s.deletedAt && (!projectId || s.projectId === projectId));

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    tasks
      .filter((t) => !t.deletedAt && (!projectId || t.projectId === projectId))
      .forEach((t) => map.set(t.id, t));
    return map;
  }, [tasks, projectId]);

  const baseColumns = useMemo(() => {
    const cols: Record<string, string[]> = {};
    filteredStates.forEach((s) => { cols[s.id] = []; });
    [...taskById.values()]
      .sort((a, b) => a.position.localeCompare(b.position))
      .forEach((t) => { if (cols[t.stateId]) cols[t.stateId].push(t.id); });
    return cols;
  }, [filteredStates, taskById]);

  const [columns, setColumns] = useState<Record<string, string[]>>(baseColumns);
  const [activeTaskKey, setActiveTaskKey] = useState<string | null>(null);
  const [overStateId, setOverStateId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!activeTaskKey) setColumns(baseColumns);
  }, [baseColumns, activeTaskKey]);
  const relationMetaByTaskId = useMemo(() => {
    const childCount = new Map<string, number>();
    const blockingCount = new Map<string, number>();
    tasks.forEach((task) => {
      if (task.deletedAt) return;
      if (task.childOfTaskId) childCount.set(task.childOfTaskId, (childCount.get(task.childOfTaskId) ?? 0) + 1);
      for (const blockerId of task.blockedByTaskIds ?? []) {
        blockingCount.set(blockerId, (blockingCount.get(blockerId) ?? 0) + 1);
      }
    });
    const out = new Map<string, { childCount: number; blockingCount: number }>();
    tasks.forEach((task) => out.set(task.id, { childCount: childCount.get(task.id) ?? 0, blockingCount: blockingCount.get(task.id) ?? 0 }));
    return out;
  }, [tasks]);

  const findContainer = useCallback((id: string, source: Record<string, string[]>) => {
    const stateId = parseStateId(id);
    if (stateId) return stateId;

    const taskId = parseTaskId(id);
    if (!taskId) return null;
    for (const [candidateStateId, ids] of Object.entries(source)) {
      if (ids.includes(taskId)) return candidateStateId;
    }
    return null;
  }, []);

  const movePreview = useCallback((prev: Record<string, string[]>, activeId: string, overId: string) => {
    const activeContainer = findContainer(activeId, prev);
    const overContainer = findContainer(overId, prev);
    const activeTaskId = parseTaskId(activeId);

    if (!activeContainer || !overContainer || !activeTaskId) return prev;

    if (activeContainer === overContainer) {
      const items = prev[activeContainer] ?? [];
      const oldIndex = items.indexOf(activeTaskId);
      const overTaskId = parseTaskId(overId);
      const newIndex = overTaskId ? items.indexOf(overTaskId) : items.length - 1;
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev;
      return { ...prev, [activeContainer]: arrayMove(items, oldIndex, newIndex) };
    }

    const fromItems = [...(prev[activeContainer] ?? [])];
    const toItems = [...(prev[overContainer] ?? [])];
    const fromIndex = fromItems.indexOf(activeTaskId);
    if (fromIndex < 0) return prev;

    fromItems.splice(fromIndex, 1);
    const overTaskId = parseTaskId(overId);
    const insertAt = overTaskId ? Math.max(0, toItems.indexOf(overTaskId)) : toItems.length;
    toItems.splice(insertAt, 0, activeTaskId);
    return { ...prev, [activeContainer]: fromItems, [overContainer]: toItems };
  }, [findContainer]);

  const collisionDetection = useMemo<CollisionDetection>(
    () => (args) => {
      const pointer = pointerWithin(args);
      if (pointer.length > 0) return pointer;
      return closestCorners(args);
    },
    []
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={(event: DragStartEvent) => {
        const activeId = String(event.active.id);
        if (parseTaskId(activeId)) setActiveTaskKey(activeId);
        setContextMenu(null);
      }}
      onDragOver={(event: DragOverEvent) => {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : null;
        if (!overId || !parseTaskId(activeId)) {
          setOverStateId(null);
          return;
        }
        setOverStateId(findContainer(overId, columns));
        setColumns((prev) => movePreview(prev, activeId, overId));
      }}
      onDragCancel={() => {
        setActiveTaskKey(null);
        setOverStateId(null);
        setColumns(baseColumns);
      }}
      onDragEnd={(event: DragEndEvent) => {
        const activeRawId = String(event.active.id);
        const overRawId = event.over ? String(event.over.id) : null;
        const activeId = parseTaskId(activeRawId);
        setOverStateId(null);

        if (!activeId || !overRawId) {
          setActiveTaskKey(null);
          setColumns(baseColumns);
          return;
        }

        const nextColumns = movePreview(columns, activeRawId, overRawId);
        setColumns(nextColumns);
        setActiveTaskKey(null);

        const nextStateId = findContainer(taskKey(activeId), nextColumns);
        if (!nextStateId) return;

        const ordered = nextColumns[nextStateId] ?? [];
        const idx = ordered.indexOf(activeId);
        const beforeTaskId = idx >= 0 ? (ordered[idx + 1] ?? null) : null;
        onMoveTask(activeId, nextStateId, beforeTaskId);
      }}
    >
      <div className="flex h-full gap-3 overflow-x-auto overflow-y-hidden p-4">
        {filteredStates.map((state) => {
          const columnTaskIds = columns[state.id] ?? [];
          return (
            <KanbanColumn
              key={state.id}
              state={state}
              count={columnTaskIds.length}
              taskIds={columnTaskIds}
              taskById={taskById}
              selectedTaskId={selectedTaskId}
              canEdit={canEdit}
              onRequestCreateTask={onRequestCreateTask}
              onSelectTask={onSelectTask}
              onOpenTaskContextMenu={(taskId, x, y) => setContextMenu({ taskId, x, y })}
              assigneeById={assigneeById}
              isOver={overStateId === state.id}
              projectLabelColorsByProjectId={projectLabelColorsByProjectId}
              relationMetaByTaskId={relationMetaByTaskId}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {activeTaskKey && parseTaskId(activeTaskKey) && taskById.get(parseTaskId(activeTaskKey)!) ? (
          <div className="w-64 rounded-xl border border-[#333] bg-[#1a1a1a] px-3 py-2.5 text-[11px] text-[#f0f0f0] opacity-95 shadow-[0_18px_38px_rgba(0,0,0,0.52)]">
            {taskById.get(parseTaskId(activeTaskKey)!)?.title || "Untitled"}
          </div>
        ) : null}
      </DragOverlay>

      <KanbanTaskContextModal
        open={!!contextMenu}
        task={contextMenu ? (taskById.get(contextMenu.taskId) ?? null) : null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        canEdit={canEdit}
        assigneeOptions={assigneeOptions}
        projectLabels={contextMenu ? (projectLabelsByProjectId.get(taskById.get(contextMenu.taskId)?.projectId ?? "") ?? []) : []}
        relationTargets={contextMenu
          ? tasks.filter(
            (entry) =>
              !entry.deletedAt &&
              entry.projectId === (taskById.get(contextMenu.taskId)?.projectId ?? "") &&
              entry.id !== contextMenu.taskId
          )
          : []
        }
        onClose={() => setContextMenu(null)}
        onUpdateTask={onQuickUpdateTask}
        onRenameTask={onRenameTask}
        onDuplicateTask={onDuplicateTask}
        onDeleteTask={onDeleteTask}
        onApplyRelation={onApplyRelation}
      />
    </DndContext>
  );
}
