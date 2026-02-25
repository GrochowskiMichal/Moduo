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
  currentUserId: string | null;
  currentUserAvatarUrl: string | null;
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
  currentUserId: string | null;
  currentUserAvatarUrl: string | null;
  onSelect: () => void;
};

function ListRow({
  task,
  depth,
  selected,
  state,
  projectName,
  taskProjectName,
  currentUserId,
  currentUserAvatarUrl,
  onSelect,
}: RowProps) {
  const sortable = useSortable({ id: `task:${task.id}` });
  const status = statusVisual(state?.kind ?? "custom");
  const priority = priorityVisual(task.priority);
  const assigneeInitial = task.assigneeId ? task.assigneeId.trim().charAt(0).toUpperCase() : "—";
  const isCurrentUserAssignee =
    !!currentUserId && !!task.assigneeId && task.assigneeId === currentUserId;
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
      className={`group grid w-full grid-cols-[minmax(220px,1fr)_130px_110px_110px_60px_24px] items-center gap-4 mb-1.5 rounded-xl px-3 py-3 text-left transition-all duration-200 border border-transparent ${selected ? "bg-[#1c1c1c]/80 border-[#333] shadow-md transform scale-[1.005]" : "hover:bg-[#151515]/80 hover:border-[#2a2a2a] hover:shadow-sm"
        }`}
      onClick={onSelect}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <span className="flex items-center gap-2 truncate text-[13px] font-medium text-[#e4e4e4]">
        {task.title || "Untitled"}
        {tags.length ? (
          <span className="ml-2 flex gap-1">
            {tags.map((tag) => (
              <span key={tag} className="rounded-md bg-[#222] border border-[#333] px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase text-[#a0a8b8]">
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-2 truncate text-[12px] text-[#9ca3af] font-medium">
        <span className="drop-shadow-sm" style={{ color: status.color }}>{status.icon}</span>
        {state?.name ?? "Unknown"}
      </span>
      <span className="flex items-center gap-1.5 text-[14px]">
        <span className="drop-shadow-sm" style={{ color: priority.color }}>{priority.icon}</span>
      </span>
      <span className="truncate text-[11px] font-medium uppercase tracking-wider text-[#6b7280]">
        {taskProjectName || projectName}
      </span>
      {isCurrentUserAssignee && currentUserAvatarUrl ? (
        <img
          src={currentUserAvatarUrl}
          alt="Assignee avatar"
          className="h-7 w-7 rounded-full border border-[#3a3a3a] object-cover shadow-inner"
        />
      ) : (
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] shadow-inner border border-[#3a3a3a] text-[11px] font-bold text-[#e0e0e0]">
          {assigneeInitial}
        </span>
      )}
      <span className="text-[14px] text-[#555] group-hover:text-[#aaa] transition-colors">…</span>
    </button>
  );
}

export function TasksList({
  tasks,
  states,
  projectName,
  projectNameById,
  currentUserId,
  currentUserAvatarUrl,
  selectedTaskId,
  onSelectTask,
  onMoveTask,
}: Props) {
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
      <div className="mb-3 grid grid-cols-[minmax(220px,1fr)_130px_110px_110px_60px_24px] gap-4 border-b border-[#222] px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-[#777]">
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
                currentUserId={currentUserId}
                currentUserAvatarUrl={currentUserAvatarUrl}
                onSelect={() => onSelectTask(row.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}
