import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState, type ReactNode } from "react";
import type { Task, TaskPriority, TaskWorkflowState } from "../types";
import { formatTaskDate, priorityVisual, statusVisual } from "./task-visuals";
import { TagInput } from "../../../components/ui/tag-input";

type Props = {
  states: TaskWorkflowState[];
  tasks: Task[];
  projectName: string;
  projectNameById: Map<string, string>;
  creatorUserId: string | null;
  assigneeOptions: Array<{ id: string; label: string; initial: string }>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onCreateTask: (
    stateId: string,
    title: string,
    description?: string,
    tags?: string[],
    priority?: TaskPriority,
    dueDate?: string | null,
    assigneeId?: string | null
  ) => Promise<void> | void;
  onMoveTask: (
    taskId: string,
    newParentTaskId: string | null,
    newStateId: string,
    beforeTaskId?: string | null
  ) => void | Promise<void>;
};

type TaskCardProps = {
  task: Task;
  state: TaskWorkflowState;
  projectName: string;
  taskProjectName: string;
  selected: boolean;
  onSelect: () => void;
};

function TaskCard({ task, state, projectName, taskProjectName, selected, onSelect }: TaskCardProps) {
  const draggable = useDraggable({ id: `task:${task.id}` });
  const droppable = useDroppable({ id: `task:${task.id}` });
  const priority = priorityVisual(task.priority);
  const dueDate = formatTaskDate(task.dueDate);
  const initial = task.assigneeId ? task.assigneeId.trim().charAt(0).toUpperCase() : null;
  const style = {
    transform: CSS.Translate.toString(draggable.transform),
    opacity: draggable.isDragging ? 0.55 : 1,
  };
  const tags = Array.isArray(task.tags) ? task.tags : [];

  return (
    <button
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      type="button"
      style={style}
      {...draggable.attributes}
      {...draggable.listeners}
      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
        droppable.isOver
          ? "border-[#3a3a3a] bg-[#161616]"
          : selected
            ? "border-[#333333] bg-[#121212]"
            : "border-[#262626] bg-[#101010] hover:bg-[#151515]"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] leading-none" style={{ color: priority.color }}>
          {priority.icon}
        </span>
        <div className="min-w-0 flex-1 truncate text-[12px] leading-tight text-[#e8ebf1]">{task.title || "Untitled"}</div>
      </div>
      {task.description ? (
        <p className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-[#777f8e]">{task.description}</p>
      ) : null}
      {tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded-full bg-[#161616] px-2 py-0.5 text-[9px] text-[#8f97a6]">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 text-[10px] text-[#6f7682]">Project: {taskProjectName || projectName}</div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] text-[#7f8796]">{dueDate ? `◷ ${dueDate}` : "No due date"}</span>
        {initial ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[#1d2129] text-[10px] font-semibold text-[#cfd4de]">
            {initial}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function ColumnDrop({ state, children }: { state: TaskWorkflowState; children: ReactNode }) {
  const droppable = useDroppable({ id: `state:${state.id}` });

  return (
    <section
      ref={droppable.setNodeRef}
      className={`min-h-[110px] rounded-xl p-1.5 ${droppable.isOver ? "bg-[#171717]" : "bg-transparent"}`}
    >
      {children}
    </section>
  );
}

export function TasksBoard({
  states,
  tasks,
  projectName,
  projectNameById,
  creatorUserId,
  assigneeOptions,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  onMoveTask,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [draftByStateId, setDraftByStateId] = useState<
    Record<string, { title: string; description: string; tags: string[]; priority: TaskPriority; dueDate: string; assigneeId: string | null }>
  >({});
  const [submittingStateId, setSubmittingStateId] = useState<string | null>(null);

  const visibleTasks = useMemo(() => tasks.filter((task) => !task.deletedAt), [tasks]);

  const tasksByState = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const state of states) grouped.set(state.id, []);

    for (const task of visibleTasks) {
      if (task.parentTaskId) continue;
      const list = grouped.get(task.stateId);
      if (!list) continue;
      list.push(task);
    }

    for (const list of grouped.values()) {
      list.sort((a, b) => a.position.localeCompare(b.position));
    }

    return grouped;
  }, [states, visibleTasks]);

  const tasksById = useMemo(() => new Map(visibleTasks.map((task) => [task.id, task])), [visibleTasks]);
  const openDraft = (stateId: string) => {
    setDraftByStateId((current) => {
      if (current[stateId]) return current;
      return {
        ...current,
        [stateId]: {
          title: "",
          description: "",
          tags: [],
          priority: 2,
          dueDate: "",
          assigneeId: creatorUserId,
        },
      };
    });
  };
  const closeDraft = (stateId: string) => {
    setDraftByStateId((current) => {
      if (!current[stateId]) return current;
      const next = { ...current };
      delete next[stateId];
      return next;
    });
  };
  const submitDraft = async (stateId: string) => {
    const draft = draftByStateId[stateId];
    if (!draft || submittingStateId) return;
    setSubmittingStateId(stateId);
    try {
      await onCreateTask(
        stateId,
        draft.title.trim(),
        draft.description.trim(),
        draft.tags,
        draft.priority,
        draft.dueDate || null,
        draft.assigneeId
      );
      closeDraft(stateId);
    } finally {
      setSubmittingStateId(null);
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || !activeId.startsWith("task:")) return;

    const movingTaskId = activeId.slice(5);
    const movingTask = tasksById.get(movingTaskId);
    if (!movingTask) return;

    if (overId.startsWith("state:")) {
      const stateId = overId.slice(6);
      if (!stateId || stateId === movingTask.stateId) return;
      await onMoveTask(movingTaskId, null, stateId, null);
      return;
    }

    if (overId.startsWith("task:")) {
      const targetTaskId = overId.slice(5);
      if (!targetTaskId || targetTaskId === movingTaskId) return;

      const targetTask = tasksById.get(targetTaskId);
      if (!targetTask) return;

      if ((event.delta?.x ?? 0) > 24) {
        await onMoveTask(movingTaskId, targetTask.id, targetTask.stateId, null);
        return;
      }

      await onMoveTask(movingTaskId, targetTask.parentTaskId, targetTask.stateId, targetTask.id);
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid grid-flow-col auto-cols-[340px] items-start gap-3 overflow-x-auto pb-2">
        {states.map((state) => {
          const columnTasks = tasksByState.get(state.id) ?? [];
          const status = statusVisual(state.kind);
          return (
            <ColumnDrop key={state.id} state={state}>
              <div className="mb-2 flex items-center gap-2 px-1.5">
                <span className="text-[13px]" style={{ color: status.color }}>
                  {status.icon}
                </span>
                <span className="text-[15px] text-[#e7ebf2]">{state.name}</span>
                <span className="text-[11px] text-[#7d8596]">{columnTasks.length}</span>
              </div>

              <div className="grid gap-2">
                {columnTasks.length === 0 ? (
                  <div className="rounded-lg bg-[#101010] px-3 py-3 text-[11px] text-[#777777]">
                    No tasks
                  </div>
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      state={state}
                      projectName={projectName}
                      taskProjectName={projectNameById.get(task.projectId) ?? projectName}
                      selected={selectedTaskId === task.id}
                      onSelect={() => onSelectTask(task.id)}
                    />
                  ))
                )}

                {draftByStateId[state.id] ? (
                  <div className="rounded-xl border border-[#2a2a2a] bg-[#101010] p-3">
                    <input
                      autoFocus
                      value={draftByStateId[state.id]?.title ?? ""}
                      onChange={(event) =>
                        setDraftByStateId((current) => ({
                          ...current,
                          [state.id]: {
                            ...(current[state.id] ?? { title: "", description: "", tags: [], priority: 2, dueDate: "", assigneeId: creatorUserId }),
                            title: event.target.value,
                          },
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submitDraft(state.id);
                        }
                        if (event.key === "Escape") closeDraft(state.id);
                      }}
                      className="w-full bg-transparent text-[12px] text-[#e8ebf1] outline-none"
                      placeholder="Task name"
                    />
                    <textarea
                      rows={2}
                      value={draftByStateId[state.id]?.description ?? ""}
                      onChange={(event) =>
                        setDraftByStateId((current) => ({
                          ...current,
                          [state.id]: {
                            ...(current[state.id] ?? { title: "", description: "", tags: [], priority: 2, dueDate: "", assigneeId: creatorUserId }),
                            description: event.target.value,
                          },
                        }))
                      }
                      className="mt-2 w-full resize-none rounded-lg bg-[#171717] px-2 py-1.5 text-[10px] text-[#9ca5b4] outline-none"
                      placeholder="Description"
                    />
                    <div className="mt-2">
                      <TagInput
                        tags={draftByStateId[state.id]?.tags ?? []}
                        onChange={(nextTags) =>
                          setDraftByStateId((current) => ({
                            ...current,
                            [state.id]: {
                              ...(current[state.id] ?? { title: "", description: "", tags: [], priority: 2, dueDate: "", assigneeId: creatorUserId }),
                              tags: nextTags,
                            },
                          }))
                        }
                        className="bg-[#171717]"
                        placeholder="Add tag and press Enter"
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-[10px] text-[#7f8796]">
                        <span>Status</span>
                        <input
                          value={state.name}
                          disabled
                          className="rounded-md bg-[#171717] px-2 py-1 text-[10px] text-[#c7cdd8] outline-none"
                        />
                      </label>
                      <label className="grid gap-1 text-[10px] text-[#7f8796]">
                        <span>Priority</span>
                        <select
                          value={draftByStateId[state.id]?.priority ?? 2}
                          className="rounded-md bg-[#171717] px-2 py-1 text-[10px] text-[#c7cdd8] outline-none"
                          onChange={(event) =>
                            setDraftByStateId((current) => ({
                              ...current,
                              [state.id]: {
                                ...(current[state.id] ?? { title: "", description: "", tags: [], priority: 2, dueDate: "", assigneeId: creatorUserId }),
                                priority: Number(event.target.value) as TaskPriority,
                              },
                            }))
                          }
                        >
                          <option value={0}>Urgent</option>
                          <option value={1}>High</option>
                          <option value={2}>Medium</option>
                          <option value={3}>Low</option>
                          <option value={4}>None</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-[10px] text-[#7f8796]">
                        <span>Assignee</span>
                        <div className="flex items-center gap-2 rounded-md bg-[#171717] px-2 py-1">
                          <span className="grid h-4 w-4 place-items-center rounded-full bg-[#222222] text-[9px] text-[#d5dbe5]">
                            {(assigneeOptions.find((entry) => entry.id === (draftByStateId[state.id]?.assigneeId ?? creatorUserId))?.initial ?? "•")}
                          </span>
                          <select
                            value={draftByStateId[state.id]?.assigneeId ?? ""}
                            className="min-w-0 flex-1 bg-transparent text-[10px] text-[#c7cdd8] outline-none"
                            onChange={(event) =>
                              setDraftByStateId((current) => ({
                                ...current,
                                [state.id]: {
                                ...(current[state.id] ?? { title: "", description: "", tags: [], priority: 2, dueDate: "", assigneeId: creatorUserId }),
                                assigneeId: event.target.value || null,
                                },
                              }))
                            }
                          >
                            <option value="">Unassigned</option>
                            {assigneeOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </label>
                      <label className="grid gap-1 text-[10px] text-[#7f8796]">
                        <span>Due date</span>
                        <input
                          type="date"
                          value={draftByStateId[state.id]?.dueDate ?? ""}
                          className="rounded-md bg-[#171717] px-2 py-1 text-[10px] text-[#c7cdd8] outline-none"
                          onChange={(event) =>
                            setDraftByStateId((current) => ({
                              ...current,
                              [state.id]: {
                                ...(current[state.id] ?? { title: "", description: "", tags: [], priority: 2, dueDate: "", assigneeId: creatorUserId }),
                                dueDate: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-md bg-[#222222] px-2 py-1 text-[10px] text-[#dbe2f0]"
                        disabled={submittingStateId === state.id}
                        onClick={() => void submitDraft(state.id)}
                      >
                        {submittingStateId === state.id ? "Creating..." : "Create"}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-[10px] text-[#7e8798]"
                        onClick={() => closeDraft(state.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className="mt-2 px-2 py-1.5 text-left text-[11px] text-[#717a89] hover:text-[#9aa3b2]"
                onClick={() => openDraft(state.id)}
              >
                + New task
              </button>
            </ColumnDrop>
          );
        })}
      </div>
    </DndContext>
  );
}
