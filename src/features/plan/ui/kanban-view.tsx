import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task, TaskWorkflowState } from "../../tasks/types";
import { priorityVisual, statusVisual } from "../../tasks/ui/task-visuals";

function taskKey(id: string) { return `task:${id}`; }
function stateKey(id: string) { return `state:${id}`; }
function parseTaskId(id: string) { return id.startsWith("task:") ? id.slice(5) : null; }
function parseStateId(id: string) { return id.startsWith("state:") ? id.slice(6) : null; }

function KanbanCard({ task, selected, onSelect, assignee, labelColors }: {
  task: Task; selected: boolean; onSelect: () => void;
  assignee: { label: string; avatarUrl: string | null; initial: string } | null;
  labelColors: Map<string, string>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: taskKey(task.id),
    transition: { duration: 170, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  });
  const pv = priorityVisual(task.priority);
  return (
    <button ref={setNodeRef} {...attributes} {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1, boxShadow: isDragging ? "0 10px 24px rgba(0,0,0,0.35)" : undefined }}
      onClick={onSelect}
      className={`group w-full rounded-xl border px-3 py-2.5 text-left transition-all cursor-grab active:cursor-grabbing ${selected ? "border-[#272727] bg-[#161616]" : "border-[#191919] bg-[#111] hover:bg-[#151515] hover:border-[#222] hover:-translate-y-px"}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[11px] shrink-0" style={{ color: pv.color }}>{pv.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-[#ddd] truncate">{task.title || "Untitled"}</div>
          {!!task.description && <div className="text-[9px] text-[#666] mt-1 line-clamp-2">{task.description}</div>}
          {!!task.tags?.length && (
            <div className="mt-1 flex flex-wrap gap-1">
              {task.tags.slice(0, 3).map(tag => (
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
  assigneeById,
  isOver,
  projectLabelColorsByProjectId,
}: {
  state: TaskWorkflowState;
  count: number;
  taskIds: string[];
  taskById: Map<string, Task>;
  selectedTaskId: string | null;
  canEdit: boolean;
  onRequestCreateTask: (stateId: string) => void;
  onSelectTask: (id: string) => void;
  assigneeById: Map<string, { label: string; avatarUrl: string | null; initial: string }>;
  isOver: boolean;
  projectLabelColorsByProjectId: Map<string, Map<string, string>>;
}) {
  const sv = statusVisual(state.kind, state.color, state.icon);
  const { setNodeRef: dropRef } = useDroppable({ id: stateKey(state.id) });
  return (
    <div className="shrink-0 w-64 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <span className="text-[11px]" style={{ color: sv.color }}>{sv.icon}</span>
        <span className="text-[11px] font-semibold text-[#ccc]">{state.name}</span>
        <span className="text-[10px] text-[#333] ml-0.5">{count}</span>
        {canEdit && <button onClick={() => onRequestCreateTask(state.id)} className="ml-auto h-5 w-5 grid place-items-center rounded text-[#2a2a2a] hover:text-[#666] hover:bg-[#1a1a1a] transition-colors">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>}
      </div>
      <div
        ref={dropRef}
        className={`flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto rounded-xl transition-all ${isOver ? "bg-[#131313] border border-[#242424] p-1.5" : ""}`}
      >
        <SortableContext items={taskIds.map(taskKey)} strategy={verticalListSortingStrategy}>
          {taskIds.map(id => {
            const t = taskById.get(id);
            if (!t) return null;
            return <KanbanCard key={t.id} task={t} selected={selectedTaskId === t.id} onSelect={() => onSelectTask(t.id)} assignee={t.assigneeId ? (assigneeById.get(t.assigneeId) ?? null) : null} labelColors={projectLabelColorsByProjectId.get(t.projectId) ?? new Map<string, string>()} />;
          })}
        </SortableContext>
        {!taskIds.length && <div className="flex-1 min-h-[48px] border border-dashed border-[#161616] rounded-xl grid place-items-center text-[9px] text-[#1e1e1e]">Drop here</div>}
      </div>
    </div>
  );
}

export function KanbanView({ states, tasks, selectedTaskId, projectId, onSelectTask, onMoveTask, onRequestCreateTask, assigneeById, canEdit, projectLabelColorsByProjectId }: {
  states: TaskWorkflowState[]; tasks: Task[]; selectedTaskId: string | null; projectId: string | null;
  onSelectTask: (id: string) => void; onMoveTask: (taskId: string, stateId: string, beforeTaskId: string | null) => void;
  onRequestCreateTask: (stateId: string) => void; canEdit: boolean;
  assigneeById: Map<string, { label: string; avatarUrl: string | null; initial: string }>;
  projectLabelColorsByProjectId: Map<string, Map<string, string>>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const filteredStates = states.filter(s => !s.deletedAt && (!projectId || s.projectId === projectId));
  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    tasks.filter(t => !t.deletedAt && !t.parentTaskId && (!projectId || t.projectId === projectId))
      .forEach(t => map.set(t.id, t));
    return map;
  }, [filteredStates, tasks, projectId]);
  const baseColumns = useMemo(() => {
    const cols: Record<string, string[]> = {};
    filteredStates.forEach(s => { cols[s.id] = []; });
    [...taskById.values()]
      .sort((a, b) => a.position.localeCompare(b.position))
      .forEach(t => { if (cols[t.stateId]) cols[t.stateId].push(t.id); });
    return cols;
  }, [filteredStates, taskById]);
  const [columns, setColumns] = useState<Record<string, string[]>>(baseColumns);
  const [activeTaskKey, setActiveTaskKey] = useState<string | null>(null);
  const [overStateId, setOverStateId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeTaskKey) setColumns(baseColumns);
  }, [baseColumns, activeTaskKey]);

  const findContainer = useCallback((id: string, source: Record<string, string[]>) => {
    const st = parseStateId(id);
    if (st) return st;
    const tid = parseTaskId(id);
    if (!tid) return null;
    for (const [stateId, ids] of Object.entries(source)) {
      if (ids.includes(tid)) return stateId;
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
      onDragStart={(e: DragStartEvent) => {
        const aid = String(e.active.id);
        if (parseTaskId(aid)) setActiveTaskKey(aid);
      }}
      onDragOver={(e: DragOverEvent) => {
        const aid = String(e.active.id);
        const oid = e.over ? String(e.over.id) : null;
        if (!oid || !parseTaskId(aid)) {
          setOverStateId(null);
          return;
        }
        setOverStateId(findContainer(oid, columns));
        setColumns(prev => movePreview(prev, aid, oid));
      }}
      onDragCancel={() => {
        setActiveTaskKey(null);
        setOverStateId(null);
        setColumns(baseColumns);
      }}
      onDragEnd={(e: DragEndEvent) => {
        const aid = String(e.active.id);
        const oid = e.over ? String(e.over.id) : null;
        const activeId = parseTaskId(aid);
        setOverStateId(null);
        if (!activeId || !oid) {
          setActiveTaskKey(null);
          setColumns(baseColumns);
          return;
        }
        const nextColumns = movePreview(columns, aid, oid);
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
        {filteredStates.map(st => {
          const colTaskIds = columns[st.id] ?? [];
          return (
            <KanbanColumn
              key={st.id}
              state={st}
              count={colTaskIds.length}
              taskIds={colTaskIds}
              taskById={taskById}
              selectedTaskId={selectedTaskId}
              canEdit={canEdit}
              onRequestCreateTask={onRequestCreateTask}
              onSelectTask={onSelectTask}
              assigneeById={assigneeById}
              isOver={overStateId === st.id}
              projectLabelColorsByProjectId={projectLabelColorsByProjectId}
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
    </DndContext>
  );
}
