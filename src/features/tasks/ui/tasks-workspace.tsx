import { useEffect, useMemo, useState } from "react";
import type { UseTasksState } from "../hooks/use-tasks";
import {
  TASKS_CREATE_ENTITY_EVENT,
  TASKS_FOCUS_SEARCH_EVENT,
  TASKS_SELECT_PROJECT_EVENT,
  type TasksCreateEntityDetail,
  type TasksSelectProjectDetail,
} from "./layout-events";
import { TasksBoard } from "./tasks-board";
import { TasksList } from "./tasks-list";
import type { Task, TaskPriority } from "../types";
import { TagInput } from "../../../components/ui/tag-input";
import {
  LAYOUT_PANELS_APPLY_EVENT,
  readFeaturePanelState,
  type LayoutPanelsApplyDetail,
} from "../../layout/panel-events";

type Props = UseTasksState;

type FilterMode = "all" | "overdue" | "no_due" | "high_priority";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("input, textarea, select, [contenteditable='true']");
}

function filterTasks(tasks: Task[], mode: FilterMode): Task[] {
  if (mode === "all") return tasks;

  const today = new Date().toISOString().slice(0, 10);

  if (mode === "overdue") {
    return tasks.filter((task) => !!task.dueDate && task.dueDate < today);
  }

  if (mode === "no_due") {
    return tasks.filter((task) => !task.dueDate);
  }

  return tasks.filter((task) => task.priority <= 1);
}

export function TasksWorkspace({
  currentUserId,
  projects,
  states,
  tasks,
  comments,
  selectedProjectId,
  selectedTaskId,
  viewMode,
  loading,
  canEdit,
  syncStatus,
  setViewMode,
  setSelectedProjectId,
  setSelectedTaskId,
  createProject,
  createWorkflowState,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  addComment,
  deleteComment,
}: Props) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [panelState, setPanelState] = useState(() => readFeaturePanelState("tasks"));
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createStateId, setCreateStateId] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createPriority, setCreatePriority] = useState<TaskPriority>(2);
  const [createDueDate, setCreateDueDate] = useState("");
  const [createTags, setCreateTags] = useState<string[]>([]);
  const [createMore, setCreateMore] = useState(false);

  const visibleProjects = useMemo(
    () => projects.filter((project) => !project.deletedAt).sort((a, b) => a.position.localeCompare(b.position)),
    [projects]
  );

  const activeProjectId = selectedProjectId;
  const allProjectsMode = activeProjectId === null;
  const activeProject = useMemo(
    () => visibleProjects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, visibleProjects]
  );

  const visibleStates = useMemo(
    () =>
      states
        .filter((state) => !state.deletedAt && (allProjectsMode || state.projectId === activeProjectId))
        .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name)),
    [activeProjectId, allProjectsMode, states]
  );

  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => !task.deletedAt && (allProjectsMode || task.projectId === activeProjectId)),
    [activeProjectId, allProjectsMode, tasks]
  );

  const filteredTasks = useMemo(
    () => filterTasks(visibleTasks, filterMode),
    [filterMode, visibleTasks]
  );

  const selectedTask = useMemo(
    () => filteredTasks.find((task) => task.id === selectedTaskId) ?? visibleTasks.find((task) => task.id === selectedTaskId) ?? null,
    [filteredTasks, selectedTaskId, visibleTasks]
  );
  const selectedTaskComments = useMemo(
    () =>
      comments
        .filter((comment) => comment.taskId === selectedTaskId && !comment.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [comments, selectedTaskId]
  );
  const parentTaskOptions = useMemo(
    () => visibleTasks.filter((task) => selectedTask && task.id !== selectedTask.id),
    [selectedTask, visibleTasks]
  );
  const canCreateTask = canEdit && !!activeProjectId && visibleStates.length > 0;
  const projectNameById = useMemo(
    () => new Map(visibleProjects.map((project) => [project.id, project.name])),
    [visibleProjects]
  );
  const showTaskEditor = taskEditorOpen && !!selectedTask;
  const assigneeOptions = useMemo(() => {
    const ids = new Set<string>();
    if (currentUserId) ids.add(currentUserId);
    for (const task of tasks) {
      if (task.assigneeId) ids.add(task.assigneeId);
    }
    return [...ids].map((id) => ({
      id,
      label: id === currentUserId ? "Me" : id,
      initial: id.trim().charAt(0).toUpperCase(),
    }));
  }, [currentUserId, tasks]);

  useEffect(() => {
    if (selectedTaskId && !visibleTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(visibleTasks[0]?.id ?? null);
    }
  }, [selectedTaskId, setSelectedTaskId, visibleTasks]);

  useEffect(() => {
    setTitleDraft(selectedTask?.title ?? "");
    setDescriptionDraft(selectedTask?.description ?? "");
    setTagsDraft(selectedTask?.tags ?? []);
    setCommentDraft("");
  }, [selectedTask?.description, selectedTask?.id, selectedTask?.tags, selectedTask?.title]);

  useEffect(() => {
    if (!selectedTask) {
      setTaskEditorOpen(false);
    }
  }, [selectedTask]);

  useEffect(() => {
    if (createModalOpen && !createStateId) {
      setCreateStateId(visibleStates[0]?.id ?? null);
    }
  }, [createModalOpen, createStateId, visibleStates]);

  const openCreateTaskModal = (stateId: string | null = null) => {
    if (!canEdit) return;
    setCreateStateId(stateId ?? visibleStates[0]?.id ?? null);
    setCreateTitle("");
    setCreateDescription("");
    setCreatePriority(2);
    setCreateDueDate("");
    setCreateTags([]);
    setCreateMore(false);
    setCreateSubmitting(false);
    setCreateModalOpen(true);
  };

  const createFromModal = async () => {
    if (!activeProjectId || !canCreateTask || createSubmitting) return;
    setCreateSubmitting(true);
    try {
      const createdId = await createTask({
        projectId: activeProjectId,
        stateId: createStateId ?? visibleStates[0]?.id ?? null,
        title: createTitle.trim() || "New Task",
      });
      if (!createdId) return;

      const patch: Parameters<typeof updateTask>[1] = {};
      if (createDescription.trim()) patch.description = createDescription.trim();
      if (createPriority !== 2) patch.priority = createPriority;
      if (createDueDate) patch.dueDate = createDueDate;
      if (createTags.length) patch.tags = createTags;
      if (Object.keys(patch).length > 0) {
        await updateTask(createdId, patch);
      }

      setSelectedTaskId(createdId);
      setTaskEditorOpen(true);

      if (createMore) {
        setCreateTitle("");
        setCreateDescription("");
        setCreatePriority(2);
        setCreateDueDate("");
        setCreateTags([]);
        return;
      }

      setCreateModalOpen(false);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const selectTaskForEditor = (taskId: string) => {
    setSelectedTaskId(taskId);
    setTaskEditorOpen(true);
  };

  const createTaskInline = async (
    stateId: string,
    title: string,
    description?: string,
    tags?: string[],
    priority?: TaskPriority,
    dueDate?: string | null,
    assigneeId?: string | null
  ) => {
    if (!canEdit) return;
    const state = visibleStates.find((entry) => entry.id === stateId);
    const resolvedProjectId = activeProjectId ?? state?.projectId ?? null;
    if (!resolvedProjectId) return;
    await createTask({
      projectId: resolvedProjectId,
      stateId,
      title: title || "New task",
      description: description || "",
      tags: tags ?? [],
      priority: priority ?? 2,
      dueDate: dueDate ?? null,
      assigneeId: assigneeId ?? currentUserId ?? null,
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onFocusSearch = () => {
      setPanelState((current) => ({ ...current, left: true }));
    };

    const onCreateEntity = async (event: Event) => {
      const detail = (event as CustomEvent<TasksCreateEntityDetail>).detail;
      if (detail?.entity === "project") {
        if (!canEdit) return;
        await createProject();
        return;
      }

      if (!canEdit) return;
      openCreateTaskModal();
      setPanelState((current) => ({ ...current, left: true }));
    };

    const onSelectProject = (event: Event) => {
      const detail = (event as CustomEvent<TasksSelectProjectDetail>).detail;
      const projectId = detail?.projectId ?? null;
      if (!projectId || visibleProjects.some((project) => project.id === projectId)) {
        setSelectedProjectId(projectId);
      }
    };

    window.addEventListener(TASKS_FOCUS_SEARCH_EVENT, onFocusSearch);
    window.addEventListener(TASKS_CREATE_ENTITY_EVENT, onCreateEntity);
    window.addEventListener(TASKS_SELECT_PROJECT_EVENT, onSelectProject);

    return () => {
      window.removeEventListener(TASKS_FOCUS_SEARCH_EVENT, onFocusSearch);
      window.removeEventListener(TASKS_CREATE_ENTITY_EVENT, onCreateEntity);
      window.removeEventListener(TASKS_SELECT_PROJECT_EVENT, onSelectProject);
    };
  }, [canEdit, createProject, setSelectedProjectId, visibleProjects, visibleStates]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onApplyPanels = (event: Event) => {
      const detail = (event as CustomEvent<LayoutPanelsApplyDetail>).detail;
      if (detail?.feature !== "tasks") return;
      setPanelState({ left: detail.left, right: detail.right });
    };
    window.addEventListener(LAYOUT_PANELS_APPLY_EVENT, onApplyPanels);
    return () => window.removeEventListener(LAYOUT_PANELS_APPLY_EVENT, onApplyPanels);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && createModalOpen) {
        event.preventDefault();
        setCreateModalOpen(false);
        return;
      }
      if (createModalOpen) return;

      if (isEditableTarget(event.target)) return;

      if (event.key.toLowerCase() === "c") {
        if (!canEdit) return;
        event.preventDefault();
        openCreateTaskModal();
        return;
      }

      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setViewMode("board");
        setTaskEditorOpen(false);
        return;
      }

      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        setViewMode("list");
        setTaskEditorOpen(false);
        return;
      }

      if ((event.key === "]" || event.key === "[") && selectedTask) {
        if (!canEdit) return;
        event.preventDefault();
        const stateIndex = visibleStates.findIndex((state) => state.id === selectedTask.stateId);
        if (stateIndex === -1) return;
        const nextIndex =
          event.key === "]"
            ? Math.min(visibleStates.length - 1, stateIndex + 1)
            : Math.max(0, stateIndex - 1);
        const nextState = visibleStates[nextIndex];
        if (!nextState || nextState.id === selectedTask.stateId) return;
        void moveTask(selectedTask.id, selectedTask.parentTaskId, nextState.id, null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, createModalOpen, moveTask, selectedTask, setViewMode, visibleStates]);

  const statusLabel =
    syncStatus === "syncing"
      ? "Syncing"
      : syncStatus === "offline"
        ? "Offline"
        : syncStatus === "error"
          ? "Sync Error"
          : "Synced";
  const layoutColumns = panelState.left
    ? panelState.right
      ? "grid-cols-[20fr_50fr_30fr]"
      : "grid-cols-[20fr_80fr]"
    : panelState.right
      ? "grid-cols-[70fr_30fr]"
      : "grid-cols-[minmax(0,1fr)]";

  if (loading) {
    return <div className="grid h-full place-content-center text-[#8f8f8f] bg-[#111111]">Loading tasks...</div>;
  }

  return (
    <div className={`grid h-full min-h-0 gap-4 p-4 bg-[#0C0C0C] ${layoutColumns}`}>
      {panelState.left ? (
        <aside className="min-h-0 overflow-y-auto rounded-2xl bg-[#111111] p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] text-[#e5e5e5]">Projects</h3>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[12px] text-[#e0e0e0]"
            disabled={!canEdit}
            onClick={() => {
              void createProject();
            }}
          >
            +
          </button>
        </div>

        <div className="grid gap-1">
          {visibleProjects.length === 0 ? (
            <div className="rounded-lg px-3 py-3 text-[12px] text-[#9a9a9a]">
              No projects yet
            </div>
          ) : (
            visibleProjects.map((project) => {
              const active = project.id === activeProjectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  className={`truncate rounded-lg px-3 py-2 text-left text-[13px] ${active ? "bg-[#1b1b1b] text-[#f0f0f0]" : "text-[#c6c6c6] hover:bg-[#181818]"}`}
                  onClick={() => {
                    setTaskEditorOpen(false);
                    setSelectedProjectId(project.id);
                  }}
                >
                  {project.name}
                </button>
              );
            })
          )}
        </div>

        {activeProjectId ? (
          <button
            type="button"
            className="mt-3 w-full rounded-lg bg-[#111111] px-3 py-2 text-[12px] text-[#e0e0e0]"
            onClick={() => {
              const name = window.prompt("State name", "In QA");
              if (!name) return;
              void createWorkflowState(activeProjectId, name, "custom");
            }}
          >
            + Add Workflow State
          </button>
        ) : null}
        </aside>
      ) : null}

      <main className="min-h-0 min-w-0 overflow-hidden rounded-2xl bg-[#111111] p-3">
        {showTaskEditor ? (
          <div className="h-full min-h-0 overflow-y-auto">
            <div className="sticky top-0 z-10 mb-4 flex items-center justify-between bg-[#111111]/95 px-2 py-2 backdrop-blur">
              <div className="flex items-center gap-2 text-[13px] text-[#b0b0b0]">
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[#e1e1e1]"
                  onClick={() => setTaskEditorOpen(false)}
                >
                  ← Back
                </button>
                <span>{activeProject?.name ?? "Project"}</span>
                <span>›</span>
                <span>{visibleStates.find((state) => state.id === selectedTask?.stateId)?.name ?? "Task"}</span>
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[12px] text-[#ffb9b9]"
                onClick={() => {
                  if (!selectedTask) return;
                  void deleteTask(selectedTask.id);
                }}
              >
                Delete
              </button>
            </div>

            {selectedTask ? (
              <div className="mx-auto grid max-w-4xl gap-5 px-2 pb-6">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => {
                    const next = titleDraft.trim() || "Untitled";
                    if (next === selectedTask.title) return;
                    void updateTask(selectedTask.id, { title: next });
                  }}
                  className="w-full border-0 bg-transparent px-1 text-[44px] font-semibold leading-[1.15] text-[#f3f3f3] outline-none"
                  placeholder="Untitled"
                />

                <textarea
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  onBlur={() => {
                    if (descriptionDraft === selectedTask.description) return;
                    void updateTask(selectedTask.id, { description: descriptionDraft });
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void updateTask(selectedTask.id, { description: descriptionDraft });
                    }
                  }}
                  rows={6}
                  className="w-full rounded-xl bg-[#141414] px-4 py-3 text-[16px] text-[#dedede] outline-none"
                  placeholder="Add description..."
                />

                <label className="grid gap-1 text-[12px] text-[#9f9f9f]">
                  <span>Tags</span>
                  <TagInput
                    tags={tagsDraft}
                    onChange={(nextTags) => {
                      setTagsDraft(nextTags);
                      const prevTags = selectedTask.tags ?? [];
                      if (nextTags.join("|") === prevTags.join("|")) return;
                      void updateTask(selectedTask.id, { tags: nextTags });
                    }}
                    placeholder="Add tag and press Enter"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1 text-[12px] text-[#9f9f9f]">
                    <span>Status</span>
                    <select
                      value={selectedTask.stateId}
                      className="rounded-lg bg-[#151515] px-3 py-2 text-[14px] text-[#e0e0e0] outline-none"
                      onChange={(event) => {
                        void updateTask(selectedTask.id, { stateId: event.target.value });
                      }}
                    >
                      {visibleStates.map((state) => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-[12px] text-[#9f9f9f]">
                    <span>Priority</span>
                    <select
                      value={selectedTask.priority}
                      className="rounded-lg bg-[#151515] px-3 py-2 text-[14px] text-[#e0e0e0] outline-none"
                      onChange={(event) => {
                        void updateTask(selectedTask.id, { priority: Number(event.target.value) as TaskPriority });
                      }}
                    >
                      <option value={0}>P0</option>
                      <option value={1}>P1</option>
                      <option value={2}>P2</option>
                      <option value={3}>P3</option>
                      <option value={4}>P4</option>
                    </select>
                  </label>

                  <label className="grid gap-1 text-[12px] text-[#9f9f9f]">
                    <span>Due date</span>
                    <input
                      type="date"
                      value={selectedTask.dueDate ?? ""}
                      className="rounded-lg bg-[#151515] px-3 py-2 text-[14px] text-[#e0e0e0] outline-none"
                      onChange={(event) => {
                        void updateTask(selectedTask.id, { dueDate: event.target.value || null });
                      }}
                    />
                  </label>
                </div>

                <label className="grid gap-1 text-[12px] text-[#9f9f9f]">
                  <span>Parent task</span>
                  <select
                    value={selectedTask.parentTaskId ?? ""}
                    className="rounded-lg bg-[#151515] px-3 py-2 text-[14px] text-[#e0e0e0] outline-none"
                    onChange={(event) => {
                      void updateTask(selectedTask.id, { parentTaskId: event.target.value || null });
                    }}
                  >
                    <option value="">None</option>
                    {parentTaskOptions.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title || "Untitled"}
                      </option>
                    ))}
                  </select>
                </label>

                <section className="mt-1 pt-5">
                  <h3 className="mb-3 text-[24px] font-semibold text-[#f0f0f0]">Activity</h3>
                  <form
                    className="mb-4 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!selectedTask || !commentDraft.trim()) return;
                      void addComment(selectedTask.id, commentDraft.trim());
                      setCommentDraft("");
                    }}
                  >
                    <input
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      placeholder="Leave a comment..."
                      className="flex-1 rounded-xl bg-[#151515] px-4 py-3 text-[15px] text-[#ededed] outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-[#1c1c1c] px-4 text-[14px] text-[#efefef]"
                    >
                      Post
                    </button>
                  </form>

                  <div className="grid gap-2">
                    {selectedTaskComments.length === 0 ? (
                      <div className="rounded-xl px-4 py-4 text-[13px] text-[#9a9a9a]">
                        No comments yet.
                      </div>
                    ) : (
                      selectedTaskComments.map((comment) => (
                        <article key={comment.id} className="rounded-xl bg-[#151515] p-3">
                          <p className="whitespace-pre-wrap text-[14px] text-[#dfdfdf]">{comment.body}</p>
                          <div className="mt-2 flex items-center justify-between text-[12px] text-[#9a9a9a]">
                            <span>{new Date(comment.createdAt).toLocaleString()}</span>
                            <button
                              type="button"
                              className="text-[#ffb9b9]"
                              onClick={() => {
                                void deleteComment(comment.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full px-2 py-1 text-[11px] text-[#c8c8c8]">{statusLabel}</span>

              <div className="flex items-center gap-2">
                {(["all", "overdue", "no_due", "high_priority"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`rounded-md px-2 py-1 text-[12px] ${filterMode === filter ? "bg-[#1b1b1b] text-[#efefef]" : "text-[#bdbdbd] hover:bg-[#181818]"}`}
                    onClick={() => setFilterMode(filter)}
                  >
                    {filter.replace("_", " ")}
                  </button>
                ))}
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-[12px] ${viewMode === "board" ? "bg-[#1b1b1b] text-[#efefef]" : "text-[#bdbdbd] hover:bg-[#181818]"}`}
                  onClick={() => setViewMode("board")}
                >
                  Board
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2 py-1 text-[12px] ${viewMode === "list" ? "bg-[#1b1b1b] text-[#efefef]" : "text-[#bdbdbd] hover:bg-[#181818]"}`}
                  onClick={() => setViewMode("list")}
                >
                  List
                </button>
              </div>
            </div>

            <div className="h-[calc(100%-52px)] min-h-0 overflow-hidden">
              {viewMode === "board" ? (
                <TasksBoard
                  states={visibleStates}
                  tasks={filteredTasks}
                  projectName={allProjectsMode ? "All projects" : activeProject?.name ?? "Project"}
                  projectNameById={projectNameById}
                  creatorUserId={currentUserId}
                  assigneeOptions={assigneeOptions}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={selectTaskForEditor}
                  onCreateTask={createTaskInline}
                  onMoveTask={(taskId, parentTaskId, stateId, beforeTaskId) =>
                    moveTask(taskId, parentTaskId, stateId, beforeTaskId ?? null)
                  }
                />
              ) : (
                <div className="h-full overflow-y-auto pr-1">
                  <TasksList
                    tasks={filteredTasks}
                    states={visibleStates}
                    projectName={allProjectsMode ? "All projects" : activeProject?.name ?? "Project"}
                    projectNameById={projectNameById}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={selectTaskForEditor}
                    onMoveTask={(taskId, parentTaskId, stateId, beforeTaskId) =>
                      moveTask(taskId, parentTaskId, stateId, beforeTaskId ?? null)
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {panelState.right ? (
        <aside className="min-h-0 rounded-2xl bg-[#111111] p-4">
          <div className="text-[#9a9a9a] text-[13px]">Graph relations tree, feature coming soon.</div>
        </aside>
      ) : null}

      {createModalOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          onClick={() => setCreateModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-[#111111]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4">
              <div className="text-[26px] font-semibold text-[#ececec]">New task</div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[18px] text-[#bdbdbd] hover:bg-[#1b1b1b]"
                onClick={() => setCreateModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="grid gap-4 px-5 py-5">
              <input
                autoFocus
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void createFromModal();
                  }
                }}
                className="w-full rounded-xl bg-[#151515] px-4 py-3 text-[30px] font-semibold text-[#f1f1f1] outline-none"
                placeholder="Task title"
              />

              <textarea
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                rows={4}
                className="w-full rounded-xl bg-[#151515] px-4 py-3 text-[15px] text-[#dbdbdb] outline-none"
                placeholder="Add description..."
              />

              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-[12px] text-[#a4a4a4]">
                  <span>Status</span>
                  <select
                    value={createStateId ?? ""}
                    className="rounded-lg bg-[#151515] px-3 py-2 text-[14px] text-[#e6e6e6] outline-none"
                    onChange={(event) => setCreateStateId(event.target.value || null)}
                  >
                    {visibleStates.map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-[12px] text-[#a4a4a4]">
                  <span>Priority</span>
                  <select
                    value={createPriority}
                    className="rounded-lg bg-[#151515] px-3 py-2 text-[14px] text-[#e6e6e6] outline-none"
                    onChange={(event) => setCreatePriority(Number(event.target.value) as TaskPriority)}
                  >
                    <option value={0}>P0</option>
                    <option value={1}>P1</option>
                    <option value={2}>P2</option>
                    <option value={3}>P3</option>
                    <option value={4}>P4</option>
                  </select>
                </label>

                <label className="grid gap-1 text-[12px] text-[#a4a4a4]">
                  <span>Due date</span>
                  <input
                    type="date"
                    value={createDueDate}
                    className="rounded-lg bg-[#151515] px-3 py-2 text-[14px] text-[#e6e6e6] outline-none"
                    onChange={(event) => setCreateDueDate(event.target.value)}
                  />
                </label>
              </div>

              <label className="grid gap-1 text-[12px] text-[#a4a4a4]">
                <span>Tags</span>
                <TagInput
                  tags={createTags}
                  onChange={setCreateTags}
                  placeholder="Add tag and press Enter"
                />
              </label>

              {!canCreateTask ? (
                <div className="text-[13px] text-[#bbbbbb]">
                  Create a project and at least one workflow state before creating tasks.
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between px-5 py-4">
              <label className="flex items-center gap-2 text-[14px] text-[#bebebe]">
                <input
                  type="checkbox"
                  checked={createMore}
                  onChange={(event) => setCreateMore(event.target.checked)}
                />
                Create more
              </label>

              <button
                type="button"
                disabled={!canCreateTask || createSubmitting}
                className="rounded-xl bg-[#1d1d1d] px-5 py-2 text-[14px] text-[#f0f0f0] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  void createFromModal();
                }}
              >
                {createSubmitting ? "Creating..." : "Create task"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
