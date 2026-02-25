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
  currentUserAvatarUrl: string | null;
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
  canEdit: boolean;
  onCreateState?: () => Promise<void> | void;
};

type TaskCardProps = {
  task: Task;
  state: TaskWorkflowState;
  projectName: string;
  taskProjectName: string;
  creatorUserId: string | null;
  currentUserAvatarUrl: string | null;
  selected: boolean;
  onSelect: () => void;
};

function TaskCard({
  task,
  state,
  projectName,
  taskProjectName,
  creatorUserId,
  currentUserAvatarUrl,
  selected,
  onSelect,
}: TaskCardProps) {
  const draggable = useDraggable({ id: `task:${task.id}` });
  const droppable = useDroppable({ id: `task:${task.id}` });
  const priority = priorityVisual(task.priority);
  const dueDate = formatTaskDate(task.dueDate);
  const initial = task.assigneeId ? task.assigneeId.trim().charAt(0).toUpperCase() : null;
  const isCurrentUserAssignee =
    !!creatorUserId && !!task.assigneeId && task.assigneeId === creatorUserId;
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
      className={`group w-full rounded-2xl border px-3.5 py-3 text-left transition-all duration-300 relative overflow-hidden backdrop-blur-md shadow-sm ${droppable.isOver
          ? "border-indigo-500/50 bg-[#1c1c1c]/80 shadow-[0_4px_24px_rgba(99,102,241,0.15)]"
          : selected
            ? "border-[#404040] bg-[#1a1a1a]/90 shadow-md transform scale-[1.02]"
            : "border-[#2a2a2a] bg-[#141414]/60 hover:bg-[#1a1a1a]/80 hover:border-[#3a3a3a] hover:shadow-lg hover:-translate-y-0.5"
        }`}
      onClick={onSelect}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[14px] leading-none drop-shadow-md" style={{ color: priority.color }}>
            {priority.icon}
          </span>
          <div className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-[#f0f2f5]">{task.title || "Untitled"}</div>
        </div>
        {task.description ? (
          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-[#8f96a3] font-light">{task.description}</p>
        ) : null}
        {tags.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-md bg-[#222] border border-[#333] px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase text-[#a0a8b8]">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3.5 mb-1 text-[10px] text-[#5f6672] uppercase tracking-wider font-semibold">
          {taskProjectName || projectName}
        </div>

        <div className="mt-2 flex items-center justify-between border-t border-[#2a2a2a]/50 pt-3">
          <span className="text-[10px] font-medium text-[#7f8796] flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            {dueDate ? dueDate : "No due date"}
          </span>
          {initial ? (
            isCurrentUserAssignee && currentUserAvatarUrl ? (
              <img
                src={currentUserAvatarUrl}
                alt="Assignee avatar"
                className="h-6 w-6 rounded-full border border-[#3a3a3a] object-cover shadow-inner"
              />
            ) : (
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] shadow-inner border border-[#3a3a3a] text-[10px] font-bold text-[#e0e0e0]">
                {initial}
              </span>
            )
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ColumnDrop({ state, children }: { state: TaskWorkflowState; children: ReactNode }) {
  const droppable = useDroppable({ id: `state:${state.id}` });

  return (
    <section
      ref={droppable.setNodeRef}
      className={`min-h-[150px] px-1.5 transition-colors duration-300 ${droppable.isOver ? "bg-[#161616]/35" : ""}`}
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
  currentUserAvatarUrl,
  assigneeOptions,
  selectedTaskId,
  onSelectTask,
  onCreateTask,
  onMoveTask,
  canEdit,
  onCreateState,
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
      <div className="grid h-full min-h-max grid-flow-col auto-cols-[340px] items-start gap-3 overflow-auto pb-4 pr-1">
        {states.map((state) => {
          const columnTasks = tasksByState.get(state.id) ?? [];
          const status = statusVisual(state.kind);
          return (
            <ColumnDrop key={state.id} state={state}>
              <div className="mb-3 px-2 pt-1 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-[14px] drop-shadow-md" style={{ color: status.color }}>
                    {status.icon}
                  </span>
                  <span className="text-[14px] font-semibold tracking-wide text-[#e7ebf2]">{state.name}</span>
                </div>
                <span className="text-[10px] font-bold text-[#888]">
                  {columnTasks.length}
                </span>
              </div>

              <div className="grid gap-2.5">
                {columnTasks.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[12px] font-medium text-[#555] opacity-60">
                    Drop tasks here
                  </div>
                ) : (
                  columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      state={state}
                      projectName={projectName}
                      taskProjectName={projectNameById.get(task.projectId) ?? projectName}
                      creatorUserId={creatorUserId}
                      currentUserAvatarUrl={currentUserAvatarUrl}
                      selected={selectedTaskId === task.id}
                      onSelect={() => onSelectTask(task.id)}
                    />
                  ))
                )}

                {draftByStateId[state.id] ? (
                  <div className="rounded-2xl border border-[#333] shadow-xl bg-[#141414] p-3 animate-in fade-in slide-in-from-top-2 duration-200">
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
                      className="w-full bg-transparent text-[14px] font-medium text-[#e8ebf1] outline-none placeholder:text-[#555]"
                      placeholder="Task name..."
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
                      className="mt-3 w-full resize-none rounded-xl border border-[#2a2a2a] bg-[#0c0c0c] px-3 py-2 text-[11px] text-[#9ca5b4] outline-none placeholder:text-[#444] focus:border-[#444] transition-colors"
                      placeholder="Add description..."
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
                          {(() => {
                            const assigneeId = draftByStateId[state.id]?.assigneeId ?? creatorUserId;
                            const initial = assigneeOptions.find((entry) => entry.id === assigneeId)?.initial ?? "•";
                            const isMe = assigneeId === creatorUserId;
                            if (isMe && currentUserAvatarUrl) {
                              return (
                                <img
                                  src={currentUserAvatarUrl}
                                  alt="Assignee avatar"
                                  className="h-4 w-4 rounded-full border border-[#2f2f2f] object-cover"
                                />
                              );
                            }
                            return (
                              <span className="grid h-4 w-4 place-items-center rounded-full bg-[#222222] text-[9px] font-bold text-[#d5dbe5]">
                                {initial}
                              </span>
                            );
                          })()}
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
        {canEdit ? (
          <section className="min-h-[150px] px-1.5">
            <div className="mb-3 px-2 pt-1 pb-2 flex items-center justify-between">
              <span className="text-[14px] font-semibold tracking-wide text-[#8f96a3]">Columns</span>
            </div>
            <button
              type="button"
              className="grid w-full place-items-center rounded-2xl border border-dashed border-[#2f3642] bg-[#11151b] px-4 py-8 text-[12px] font-medium text-[#7f8796] transition-colors hover:border-[#4b5568] hover:text-[#c7cfde]"
              onClick={() => void onCreateState?.()}
            >
              + New column
            </button>
          </section>
        ) : null}
      </div>
    </DndContext>
  );
}
