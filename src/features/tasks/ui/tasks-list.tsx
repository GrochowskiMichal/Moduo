import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo } from "react";
import { buildTaskTree, flattenTaskTree } from "../utils/hierarchy";
import type { Task, TaskWorkflowState } from "../types";
import { priorityVisual, statusVisual } from "./task-visuals";

type Props = {
  tasks: Task[];
  states: TaskWorkflowState[];
  projectName: string;
  projectNameById: Map<string, string>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onMoveTask: (
    taskId: string,
    newParentTaskId: string | null,
    newStateId: string,
    beforeTaskId?: string | null
  ) => void | Promise<void>;
};

type RowProps = {
  task: Task;
  depth: number;
  selected: boolean;
  state: TaskWorkflowState | null;
  projectName: string;
  taskProjectName: string;
  onSelect: () => void;
};

function ListRow({ task, depth, selected, state, projectName, taskProjectName, onSelect }: RowProps) {
  const sortable = useSortable({ id: `task:${task.id}` });
  const status = statusVisual(state?.kind ?? "custom");
  const priority = priorityVisual(task.priority);
  const assigneeInitial = task.assigneeId ? task.assigneeId.trim().charAt(0).toUpperCase() : "—";
  const tags = Array.isArray(task.tags) ? task.tags : [];

  return (
    <button
      ref={sortable.setNodeRef}
      type="button"
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        marginLeft: depth * 18,
        opacity: sortable.isDragging ? 0.55 : 1,
      }}
      className={`grid w-full grid-cols-[minmax(220px,1fr)_130px_110px_110px_60px_24px] items-center gap-2 border-b border-[#1e2128] px-2.5 py-2 text-left ${
        selected ? "bg-[#121417]" : "hover:bg-[#111419]"
      }`}
      onClick={onSelect}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <span className="truncate text-[12px] text-[#dbe0e8]">
        {task.title || "Untitled"}
        {tags.length ? (
          <span className="ml-2 text-[10px] text-[#8a93a3]">{tags.map((tag) => `#${tag}`).join(" ")}</span>
        ) : null}
      </span>
      <span className="flex items-center gap-1.5 truncate text-[11px] text-[#8f97a6]">
        <span style={{ color: status.color }}>{status.icon}</span>
        {state?.name ?? "Unknown"}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-[#8f97a6]">
        <span style={{ color: priority.color }}>{priority.icon}</span>
      </span>
      <span className="truncate text-[11px] text-[#858d9d]">Project: {taskProjectName || projectName}</span>
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#1b2028] text-[10px] font-semibold text-[#d5dbe5]">
        {assigneeInitial}
      </span>
      <span className="text-[13px] text-[#767f8f]">…</span>
    </button>
  );
}

export function TasksList({ tasks, states, projectName, projectNameById, selectedTaskId, onSelectTask, onMoveTask }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const stateById = useMemo(() => new Map(states.map((state) => [state.id, state])), [states]);

  const visibleTasks = useMemo(() => tasks.filter((task) => !task.deletedAt), [tasks]);

  const flat = useMemo(() => flattenTaskTree(buildTaskTree(visibleTasks)), [visibleTasks]);
  const byId = useMemo(() => new Map(flat.map((row) => [row.id, row])), [flat]);

  const onDragEnd = async (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId || !activeId.startsWith("task:") || !overId.startsWith("task:")) return;

    const taskId = activeId.slice(5);
    const targetId = overId.slice(5);
    if (!taskId || !targetId || taskId === targetId) return;

    const moving = byId.get(taskId);
    const target = byId.get(targetId);
    if (!moving || !target) return;

    if ((event.delta?.x ?? 0) > 24) {
      await onMoveTask(taskId, target.id, target.stateId, null);
      return;
    }

    await onMoveTask(taskId, target.parentTaskId, target.stateId, target.id);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="mb-1 grid grid-cols-[minmax(220px,1fr)_130px_110px_110px_60px_24px] gap-2 border-b border-[#1e2128] px-2.5 py-2 text-[10px] uppercase tracking-[0.08em] text-[#666f80]">
        <span>Title</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Project</span>
        <span>Assignee</span>
        <span />
      </div>

      <SortableContext items={flat.map((row) => `task:${row.id}`)} strategy={verticalListSortingStrategy}>
        <div className="grid">
          {flat.length === 0 ? (
            <div className="rounded-xl px-4 py-5 text-[13px] text-[#7c899f]">
              No tasks yet.
            </div>
          ) : (
            flat.map((row) => (
              <ListRow
                key={row.id}
                task={row}
                depth={row.depth}
                selected={selectedTaskId === row.id}
                state={stateById.get(row.stateId) ?? null}
                projectName={projectName}
                taskProjectName={projectNameById.get(row.projectId) ?? projectName}
                onSelect={() => onSelectTask(row.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}
