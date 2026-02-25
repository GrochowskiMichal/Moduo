import { useEffect, useMemo, useState } from "react";
import type { UseTasksState } from "../hooks/use-tasks";
import {
  dispatchTasksSelectProject,
  TASKS_CREATE_ENTITY_EVENT,
  TASKS_FOCUS_SEARCH_EVENT,
  TASKS_SELECT_PROJECT_EVENT,
  type TasksCreateEntityDetail,
  type TasksSelectProjectDetail,
} from "./layout-events";
import { TasksBoard } from "./tasks-board";
import { TasksList } from "./tasks-list";
import { TasksGantt } from "./tasks-gantt";
import type { Task, TaskPriority } from "../types";
import { TagInput } from "../../../components/ui/tag-input";
import { List as ListIcon, SquareChartGantt, SquareKanban } from "lucide-react";
import {
  LAYOUT_PANELS_APPLY_EVENT,
  readFeaturePanelState,
  type LayoutPanelsApplyDetail,
} from "../../layout/panel-events";

type Props = UseTasksState;

type FilterMode = "all" | "overdue" | "no_due" | "high_priority";
const AVATAR_STORAGE_KEY = "moduo:auth-avatar-preview-v1";

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
  setViewMode,
  setSelectedProjectId,
  setSelectedTaskId,
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
  const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | null>(null);

  const visibleProjects = useMemo(
    () => projects.filter((project) => !project.deletedAt).sort((a, b) => a.position.localeCompare(b.position)),
    [projects]
  );
  const visibleProjectIds = useMemo(() => new Set(visibleProjects.map((project) => project.id)), [visibleProjects]);

  const activeProjectId = selectedProjectId;
  const allProjectsMode = activeProjectId === null;
  const activeProject = useMemo(
    () => visibleProjects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, visibleProjects]
  );

  const visibleStates = useMemo(
    () =>
      states
        .filter(
          (state) =>
            !state.deletedAt &&
            visibleProjectIds.has(state.projectId) &&
            (allProjectsMode || state.projectId === activeProjectId)
        )
        .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name)),
    [activeProjectId, allProjectsMode, states, visibleProjectIds]
  );

  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          !task.deletedAt &&
          visibleProjectIds.has(task.projectId) &&
          (allProjectsMode || task.projectId === activeProjectId)
      ),
    [activeProjectId, allProjectsMode, tasks, visibleProjectIds]
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
      initial: id === currentUserId ? "M" : id.trim().charAt(0).toUpperCase(),
    }));
  }, [currentUserId, tasks]);
  const currentUserInitial = useMemo(
    () => (currentUserId ? "M" : "U"),
    [currentUserId]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readAvatar = () => setCurrentUserAvatarUrl(window.localStorage.getItem(AVATAR_STORAGE_KEY));
    readAvatar();
    window.addEventListener("storage", readAvatar);
    return () => window.removeEventListener("storage", readAvatar);
  }, []);

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
      setPanelState((current) => ({ ...current, left: false }));
    };

    const onCreateEntity = async (event: Event) => {
      const detail = (event as CustomEvent<TasksCreateEntityDetail>).detail;
      if (detail?.entity === "project") {
        return;
      }

      if (!canEdit) return;
      openCreateTaskModal();
      setPanelState((current) => ({ ...current, left: false }));
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
  }, [canEdit, setSelectedProjectId, visibleProjects, visibleStates]);

  useEffect(() => {
    dispatchTasksSelectProject(activeProjectId);
  }, [activeProjectId]);

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

      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        setViewMode("gantt");
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

  const createStatusFromBoard = async () => {
    if (!activeProjectId || !canEdit) return;
    const baseName = "New Status";
    const existingNames = new Set(visibleStates.map((state) => state.name.trim().toLowerCase()));
    let nextName = baseName;
    let i = 2;
    while (existingNames.has(nextName.toLowerCase())) {
      nextName = `${baseName} ${i}`;
      i += 1;
    }
    await createWorkflowState(activeProjectId, nextName, "custom");
  };

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
    <div className={`grid h-full min-h-0 gap-4 bg-[#0C0C0C] px-4 pb-2 pt-2 ${layoutColumns}`}>
      {panelState.left ? (
        <aside className="min-h-0 h-full rounded-2xl bg-[#111111] p-4 flex flex-col overflow-y-auto overflow-x-hidden">
          <div className="grid h-full place-items-center rounded-2xl border border-dashed border-[#262626] bg-[#0f0f0f]">
            <div className="px-4 text-center text-[12px] text-[#666666]">
              Left panel reserved for global layout.
            </div>
          </div>
        </aside>
      ) : null}

      <main className="min-h-0 h-full min-w-0 overflow-hidden rounded-2xl bg-[#111111] p-4 flex flex-col">
        {showTaskEditor ? (
          <div className="h-full min-h-0 overflow-y-auto custom-scrollbar px-2 md:px-6 pb-12">
            <div className="sticky top-0 z-20 mb-8 flex items-center justify-between bg-[#111111]/80 backdrop-blur-xl border-b border-[#222] px-4 py-3 -mx-2 md:-mx-6 shadow-sm">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  className="grid place-items-center w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#333] text-[#aaa] hover:bg-[#252525] hover:text-[#fff] transition-all"
                  onClick={() => setTaskEditorOpen(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                </button>
                <div className="flex items-center gap-2 text-[12px] font-medium text-[#777]">
                  <span className="bg-[#1a1a1a] px-2.5 py-1.5 rounded-lg border border-[#2a2a2a] text-[#ccc]">{activeProject?.name ?? "Project"}</span>
                  <span className="text-[#444]">/</span>
                  <span className="bg-[#1a1a1a] px-2.5 py-1.5 rounded-lg border border-[#2a2a2a] text-[#ccc]">{visibleStates.find((state) => state.id === selectedTask?.stateId)?.name ?? "Task"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl px-4 py-2 text-[12px] font-bold text-[#ef4444] bg-[#ef4444]/10 hover:bg-[#ef4444]/20 transition-all border border-[#ef4444]/20"
                  onClick={() => {
                    if (!selectedTask) return;
                    if (window.confirm("Are you sure you want to delete this task?")) {
                      void deleteTask(selectedTask.id);
                    }
                  }}
                >
                  Delete Task
                </button>
              </div>
            </div>

            {selectedTask ? (
              <div className="mx-auto max-w-5xl flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col gap-3">
                  <input
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => {
                      const next = titleDraft.trim() || "Untitled";
                      if (next === selectedTask.title) return;
                      void updateTask(selectedTask.id, { title: next });
                    }}
                    className="w-full bg-transparent text-[42px] font-bold leading-[1.15] tracking-tight text-[#f3f3f3] outline-none placeholder:text-[#333] transition-all"
                    placeholder="Task Title"
                  />
                  <div className="flex items-center gap-3 text-[12px] text-[#666] font-medium ml-1">
                    <span>Created {new Date(selectedTask.createdAt).toLocaleDateString()}</span>
                    <span className="w-1 h-1 rounded-full bg-[#333]" />
                    <span>ID: {selectedTask.id.slice(0, 8)}</span>
                  </div>

                  {/* Properties Row */}
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {/* Status */}
                    <div className="relative group flex items-center gap-1.5 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2.5 py-1.5 hover:bg-[#1a1a1a] hover:border-[#444] transition-colors focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#888]"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                      <select
                        value={selectedTask.stateId}
                        className="appearance-none bg-transparent text-[13px] font-medium text-[#e0e0e0] outline-none cursor-pointer pr-4 hover:text-white transition-colors"
                        onChange={(event) => void updateTask(selectedTask.id, { stateId: event.target.value })}
                      >
                        {visibleStates.map((state) => (
                          <option key={state.id} value={state.id} className="bg-[#111]">{state.name}</option>
                        ))}
                      </select>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-2 text-[#666] pointer-events-none group-hover:text-[#aaa] transition-colors"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>

                    {/* Priority */}
                    <div className="relative group flex items-center gap-1.5 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2.5 py-1.5 hover:bg-[#1a1a1a] hover:border-[#444] transition-colors focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#888]"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                      <select
                        value={selectedTask.priority}
                        className="appearance-none bg-transparent text-[13px] font-medium text-[#e0e0e0] outline-none cursor-pointer pr-4 hover:text-white transition-colors"
                        onChange={(event) => void updateTask(selectedTask.id, { priority: Number(event.target.value) as TaskPriority })}
                      >
                        <option value={0} className="bg-[#111]">🔥 Urgent</option>
                        <option value={1} className="bg-[#111]">⚡ High</option>
                        <option value={2} className="bg-[#111]">◼ Medium</option>
                        <option value={3} className="bg-[#111]">◽ Low</option>
                        <option value={4} className="bg-[#111]">⚪ None</option>
                      </select>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-2 text-[#666] pointer-events-none group-hover:text-[#aaa] transition-colors"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>

                    {/* Assignee */}
                    <div className="relative group flex items-center gap-1.5 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2.5 py-1.5 hover:bg-[#1a1a1a] hover:border-[#444] transition-colors focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#888]"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                      <select
                        value={selectedTask.assigneeId ?? ""}
                        className="appearance-none bg-transparent text-[13px] font-medium text-[#e0e0e0] outline-none cursor-pointer pr-4 hover:text-white transition-colors"
                        onChange={(event) => void updateTask(selectedTask.id, { assigneeId: event.target.value || null })}
                      >
                        <option value="" className="bg-[#111]">Unassigned</option>
                        {assigneeOptions.map((opt) => (
                          <option key={opt.id} value={opt.id} className="bg-[#111]">{opt.label}</option>
                        ))}
                      </select>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-2 text-[#666] pointer-events-none group-hover:text-[#aaa] transition-colors"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>

                    {/* Due Date */}
                    <div className="relative group flex items-center gap-1.5 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2.5 py-1.5 hover:bg-[#1a1a1a] hover:border-[#444] transition-colors focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#888]"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                      <input
                        type="date"
                        value={selectedTask.dueDate ?? ""}
                        className="appearance-none bg-transparent text-[13px] font-medium text-[#e0e0e0] outline-none cursor-pointer [color-scheme:dark] hover:text-white transition-colors"
                        onChange={(event) => void updateTask(selectedTask.id, { dueDate: event.target.value || null })}
                      />
                    </div>

                    {/* Parent Task */}
                    <div className="relative group flex items-center gap-1.5 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2.5 py-1.5 hover:bg-[#1a1a1a] hover:border-[#444] transition-colors focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#888]"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                      <select
                        value={selectedTask.parentTaskId ?? ""}
                        className="appearance-none bg-transparent text-[13px] font-medium text-[#e0e0e0] outline-none cursor-pointer pr-4 max-w-[150px] truncate hover:text-white transition-colors"
                        onChange={(event) => void updateTask(selectedTask.id, { parentTaskId: event.target.value || null })}
                      >
                        <option value="" className="bg-[#111]">No Parent</option>
                        {parentTaskOptions.map((task) => (
                          <option key={task.id} value={task.id} className="bg-[#111]">
                            {task.title || "Untitled"}
                          </option>
                        ))}
                      </select>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="absolute right-2 text-[#666] pointer-events-none group-hover:text-[#aaa] transition-colors"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  </div>
                </div>

                {/* Main Document Content */}
                <div className="flex flex-col gap-6 w-full">

                  <div className="flex flex-col gap-2 mt-4 relative group">
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
                      rows={8}
                      className="w-full resize-y bg-transparent px-2 py-3 text-[15px] font-medium leading-[1.6] text-[#d4d4d4] outline-none hover:bg-[#1a1a1a]/40 focus:bg-[#1a1a1a]/60 rounded-2xl transition-all placeholder:text-[#555] custom-scrollbar"
                      placeholder="Add a detailed description here..."
                    />
                    {!descriptionDraft && (
                      <div className="absolute top-3 left-2 pointer-events-none text-[#555] opacity-0 group-hover:opacity-100 transition-opacity text-[15px] font-medium flex items-center gap-2">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                        Click to add description...
                      </div>
                    )}
                  </div>

                  <div className="h-px w-full bg-gradient-to-r from-transparent via-[#333] to-transparent my-2" />

                  <div className="flex flex-col gap-3 px-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-[#666] flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
                      Tags
                    </h4>
                    <div className="min-h-[40px] flex items-center">
                      <TagInput
                        tags={tagsDraft}
                        onChange={(nextTags) => {
                          setTagsDraft(nextTags);
                          const prevTags = selectedTask.tags ?? [];
                          if (nextTags.join("|") === prevTags.join("|")) return;
                          void updateTask(selectedTask.id, { tags: nextTags });
                        }}
                        className="bg-transparent !p-0 border-0"
                        placeholder="Add tag..."
                      />
                    </div>
                  </div>

                  <div className="h-[1px] w-full bg-gradient-to-r from-[#222] to-transparent my-6" />

                  <div className="flex flex-col gap-6 px-2 mb-8">
                    <h4 className="text-[14px] font-bold text-[#e0e0e0] flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#888]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                      Activity Feed
                    </h4>

                    <div className="flex flex-col gap-4">
                      {selectedTaskComments.length === 0 ? (
                        <div className="py-8 text-center text-[13px] text-[#666] font-medium border border-dashed border-[#2a2a2a] rounded-2xl bg-[#141414]/50">
                          No activity yet. Start the conversation!
                        </div>
                      ) : (
                        selectedTaskComments.map((comment) => (
                          <article key={comment.id} className="group relative flex gap-4 p-3 rounded-2xl hover:bg-[#1a1a1a]/80 transition-colors">
                            <div className="flex-shrink-0 mt-1">
                              {comment.ownerId && comment.ownerId === currentUserId && currentUserAvatarUrl ? (
                                <img
                                  src={currentUserAvatarUrl}
                                  alt="Author avatar"
                                  className="h-8 w-8 rounded-full border border-[#444] object-cover shadow-sm"
                                />
                              ) : (
                                <span className="grid place-items-center w-8 h-8 rounded-full bg-gradient-to-br from-[#333] to-[#222] text-[#fff] text-[12px] font-bold border border-[#444] shadow-sm">
                                  {comment.ownerId ? comment.ownerId.charAt(0).toUpperCase() : "U"}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 w-full min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-[12px] font-semibold text-[#888]">
                                  {new Date(comment.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                                </span>
                                <button
                                  type="button"
                                  className="text-[#666] hover:text-[#ef4444] transition-colors p-1 opacity-0 group-hover:opacity-100"
                                  title="Delete comment"
                                  onClick={() => {
                                    if (window.confirm("Delete this comment?")) {
                                      void deleteComment(comment.id);
                                    }
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                </button>
                              </div>
                              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#eee]">{comment.body}</p>
                            </div>
                          </article>
                        ))
                      )}
                    </div>

                    <form
                      className="mt-2 relative flex items-end gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!selectedTask || !commentDraft.trim()) return;
                        void addComment(selectedTask.id, commentDraft.trim());
                        setCommentDraft("");
                      }}
                    >
                      <div className="flex-shrink-0 mb-1">
                        {currentUserAvatarUrl ? (
                          <img
                            src={currentUserAvatarUrl}
                            alt="Your avatar"
                            className="h-8 w-8 rounded-full border border-indigo-400/40 object-cover shadow-md shadow-indigo-500/20"
                          />
                        ) : (
                          <span className="grid place-items-center w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-indigo-500 text-[#fff] text-[12px] font-bold shadow-md shadow-indigo-500/20">
                            {currentUserInitial}
                          </span>
                        )}
                      </div>
                      <div className="relative flex-1">
                        <input
                          value={commentDraft}
                          onChange={(event) => setCommentDraft(event.target.value)}
                          placeholder="Reply... (Press Enter to send)"
                          className="w-full rounded-2xl border border-[#333] bg-[#121212] pl-4 pr-20 py-3.5 text-[14px] font-medium text-[#ededed] shadow-inner shadow-black/40 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all placeholder:text-[#666]"
                        />
                        <button
                          type="submit"
                          disabled={!commentDraft.trim()}
                          className="absolute right-2 top-2 bottom-2 rounded-xl bg-[#2a2a2a] hover:bg-[#333] hover:text-white px-4 text-[13px] font-bold text-[#aaa] disabled:opacity-30 disabled:hover:bg-[#2a2a2a] disabled:hover:text-[#aaa] transition-all"
                        >
                          Send
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-[#1c1c1c] pb-4">
              <div className="flex items-center gap-1.5 bg-[#151515] p-1 rounded-xl border border-[#222]">
                {(["all", "overdue", "no_due", "high_priority"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${filterMode === filter ? "bg-[#252525] text-[#ffffff] shadow-sm shadow-black/40" : "text-[#777] hover:text-[#bbb] hover:bg-[#1d1d1d]"}`}
                    onClick={() => setFilterMode(filter)}
                  >
                    {filter.replace("_", " ")}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 bg-[#151515] p-1 rounded-xl border border-[#222]">
                <button
                  type="button"
                  aria-label="Kanban view"
                  title="Kanban view"
                  className={`grid h-8 w-8 place-items-center rounded-lg transition-all ${viewMode === "board" ? "bg-[#252525] text-[#ffffff] shadow-sm shadow-black/40" : "text-[#777] hover:text-[#bbb] hover:bg-[#1d1d1d]"}`}
                  onClick={() => setViewMode("board")}
                >
                  <SquareKanban size={14} />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  title="List view"
                  className={`grid h-8 w-8 place-items-center rounded-lg transition-all ${viewMode === "list" ? "bg-[#252525] text-[#ffffff] shadow-sm shadow-black/40" : "text-[#777] hover:text-[#bbb] hover:bg-[#1d1d1d]"}`}
                  onClick={() => setViewMode("list")}
                >
                  <ListIcon size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Gantt view"
                  title="Gantt view"
                  className={`grid h-8 w-8 place-items-center rounded-lg transition-all ${viewMode === "gantt" ? "bg-[#252525] text-[#ffffff] shadow-sm shadow-black/40" : "text-[#777] hover:text-[#bbb] hover:bg-[#1d1d1d]"}`}
                  onClick={() => setViewMode("gantt")}
                >
                  <SquareChartGantt size={14} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {viewMode === "board" ? (
                <div className="h-full min-h-0 overflow-auto pr-1">
                  <TasksBoard
                    states={visibleStates}
                    tasks={filteredTasks}
                    projectName={allProjectsMode ? "All projects" : activeProject?.name ?? "Project"}
                    projectNameById={projectNameById}
                    creatorUserId={currentUserId}
                    currentUserAvatarUrl={currentUserAvatarUrl}
                    assigneeOptions={assigneeOptions}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={selectTaskForEditor}
                    onCreateTask={createTaskInline}
                    onMoveTask={(taskId, parentTaskId, stateId, beforeTaskId) =>
                      moveTask(taskId, parentTaskId, stateId, beforeTaskId ?? null)
                    }
                    canEdit={canEdit && !allProjectsMode}
                    onCreateState={createStatusFromBoard}
                  />
                </div>
              ) : viewMode === "list" ? (
                <div className="h-full min-h-0 overflow-auto pr-1">
                  <TasksList
                    tasks={filteredTasks}
                    states={visibleStates}
                    projectName={allProjectsMode ? "All projects" : activeProject?.name ?? "Project"}
                    projectNameById={projectNameById}
                    currentUserId={currentUserId}
                    currentUserAvatarUrl={currentUserAvatarUrl}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={selectTaskForEditor}
                    onMoveTask={(taskId, parentTaskId, stateId, beforeTaskId) =>
                      moveTask(taskId, parentTaskId, stateId, beforeTaskId ?? null)
                    }
                  />
                </div>
              ) : (
                <div className="h-full min-h-0">
                  <TasksGantt
                    tasks={filteredTasks}
                    selectedTaskId={selectedTaskId}
                    projectNameById={projectNameById}
                    onSelectTask={selectTaskForEditor}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {panelState.right ? (
        <aside className="min-h-0 h-full rounded-2xl bg-[#111111] p-6 flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
          </div>
          <h3 className="text-[#eeeeee] font-medium text-[15px] mb-2 text-center">Graph Relations</h3>
          <p className="text-[#777777] text-[12px] text-center max-w-[200px] leading-relaxed">
            A future intelligent graph view will reside here, allowing visualizing complex connections between your tasks and data.
          </p>
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
