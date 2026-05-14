import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useCalendar } from "../../calendar/hooks/use-calendar";
import { useTasks } from "../../tasks/hooks/use-tasks";
import type { CalendarEvent } from "../../calendar/types";
import type { Task, TaskRelationKind } from "../../tasks/types";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { PlanNav, clampView, type PlanNavProps, type CalDensity, type PlanNavState } from "./plan-nav";
import { dispatchLayoutPanelsApply, readFeaturePanelState } from "../../layout/panel-events";
import { ProjectSettingsGeneral, ProjectSettingsLabels, ProjectSettingsNav, ProjectSettingsStages } from "./project-settings-panel";
import { PLAN_SELECT_TASK_EVENT, type PlanSelectTaskDetail } from "./layout-events";
import { TaskDetailsView } from "./task-details-view";
import { KanbanView } from "./kanban-view";
import { ListView } from "./list-view";
import { PlanCalendarView } from "./calendar-view";
import { LinkView } from "./link-view";
import { GanttView } from "./gantt-view";
import { KanbanTaskContextModal } from "./kanban-task-context-modal";
import {
    AVATAR_STORAGE_KEY,
    AVATAR_STORE_KEY,
    AVATAR_STORE_NAMESPACE,
    PLAN_VIEW_STORAGE_KEY,
    RELATION_LABELS,
    compareStages,
    readSavedPlanView,
} from "./plan-workspace-helpers";
import { NewEventPanel, NewTaskPanel } from "./plan-create-panels";

// ─── main workspace ───────────────────────────────────────────────────────────
export function PlanWorkspace() {
    const { runtime, userId } = useAuth();
    const { selectedWorkspaceId, modulePermissions } = useWorkspace();
    const navigate = useNavigate();

    const cal = useCalendar();
    const tsk = useTasks(runtime, { userId, workspaceId: selectedWorkspaceId, modulePermission: modulePermissions.tasks });

    const savedView = readSavedPlanView();
    const [nav, setNav] = useState<PlanNavState>(savedView?.nav ?? { section: "all", view: "calendar", density: "week", calendarId: null, projectId: null });
    const [leftPanel, setLeftPanel] = useState<
        | { mode: "new-task"; defaultStateId: string | null }
        | { mode: "new-event"; defaultCalendarId: string | null }
        | null
    >(null);
    const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
    const [settingsSection, setSettingsSection] = useState<"general" | "stages" | "labels">("general");
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [taskContextMenu, setTaskContextMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
    const handleSelectTask = useCallback((id: string) => {
        if (nav.view === "kanban" || nav.view === "gantt") setSelectedTaskId(id);
    }, [nav.view]);

    // fix 7: focusDate drives grid navigation
    const [focusDate, setFocusDate] = useState<Date>(() => savedView?.focusDate ?? new Date());

    const handleNavigate = (dir: -1 | 1) => {
        setFocusDate(prev => {
            const d = new Date(prev);
            if (nav.density === "day") d.setDate(d.getDate() + dir);
            else if (nav.density === "week") d.setDate(d.getDate() + dir * 7);
            else d.setMonth(d.getMonth() + dir);
            return d;
        });
    };

    const visEvents = useMemo(() => cal.getVisibleEvents(), [cal.getVisibleEvents]);
    const filteredEvents = useMemo(() => nav.calendarId ? visEvents.filter(e => e.calendarId === nav.calendarId) : visEvents, [visEvents, nav.calendarId]);
    const visProjects = useMemo(() => tsk.projects.filter(p => !p.deletedAt), [tsk.projects]);
    const visibleProjectIds = useMemo(() => new Set(visProjects.map(p => p.id)), [visProjects]);
    const visStates = useMemo(
        () => tsk.states
            .filter(s => !s.deletedAt && visibleProjectIds.has(s.projectId))
            .sort(compareStages),
        [tsk.states, visibleProjectIds]
    );
    const filteredTasks = useMemo(() => {
        let t = tsk.tasks.filter(task => !task.deletedAt && visibleProjectIds.has(task.projectId));
        if (nav.projectId) t = t.filter(tk => tk.projectId === nav.projectId);
        return t;
    }, [tsk.tasks, nav.projectId, visibleProjectIds]);
    const activeTasks = useMemo(
        () => tsk.tasks.filter(task => !task.deletedAt && visibleProjectIds.has(task.projectId)),
        [tsk.tasks, visibleProjectIds]
    );
    const activeTaskById = useMemo(
        () => new Map(activeTasks.map(task => [task.id, task])),
        [activeTasks]
    );
    const selectedTask = useMemo(
        () => (selectedTaskId ? filteredTasks.find(t => t.id === selectedTaskId) ?? null : null),
        [filteredTasks, selectedTaskId]
    );
    const selectedTaskRelationTargets = useMemo(
        () => selectedTask ? activeTasks.filter(task => task.projectId === selectedTask.projectId && task.id !== selectedTask.id) : [],
        [activeTasks, selectedTask]
    );
    const blockingByTaskId = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const task of activeTasks) {
            for (const blockedById of task.blockedByTaskIds ?? []) {
                const list = map.get(blockedById) ?? [];
                list.push(task.id);
                map.set(blockedById, list);
            }
        }
        return map;
    }, [activeTasks]);
    const selectedTaskRelations = useMemo(() => {
        if (!selectedTask) return [];
        const entries: Array<{ kind: TaskRelationKind; label: string; targetId: string; targetTitle: string }> = [];
        if (selectedTask.childOfTaskId) {
            const parent = activeTaskById.get(selectedTask.childOfTaskId);
            if (parent) entries.push({ kind: "child_of", label: RELATION_LABELS.child_of, targetId: parent.id, targetTitle: parent.title || "Untitled" });
        }
        for (const child of activeTasks.filter(task => task.childOfTaskId === selectedTask.id)) {
            entries.push({ kind: "parent_of", label: RELATION_LABELS.parent_of, targetId: child.id, targetTitle: child.title || "Untitled" });
        }
        for (const blockedById of selectedTask.blockedByTaskIds ?? []) {
            const blockedByTask = activeTaskById.get(blockedById);
            if (blockedByTask) entries.push({ kind: "blocked_by", label: RELATION_LABELS.blocked_by, targetId: blockedByTask.id, targetTitle: blockedByTask.title || "Untitled" });
        }
        for (const blockedTaskId of blockingByTaskId.get(selectedTask.id) ?? []) {
            const blockedTask = activeTaskById.get(blockedTaskId);
            if (blockedTask) entries.push({ kind: "blocking", label: RELATION_LABELS.blocking, targetId: blockedTask.id, targetTitle: blockedTask.title || "Untitled" });
        }
        if (selectedTask.duplicateOfTaskId) {
            const duplicateOf = activeTaskById.get(selectedTask.duplicateOfTaskId);
            if (duplicateOf) entries.push({ kind: "duplicate_of", label: RELATION_LABELS.duplicate_of, targetId: duplicateOf.id, targetTitle: duplicateOf.title || "Untitled" });
        }
        return entries;
    }, [activeTaskById, activeTasks, blockingByTaskId, selectedTask]);
    const projectNameById = useMemo(() => new Map(visProjects.map(p => [p.id, p.name])), [visProjects]);
    const projectLabelColorsByProjectId = useMemo(
        () => new Map(visProjects.map(project => [project.id, new Map((project.labels ?? []).map(label => [label.name, label.color]))])),
        [visProjects]
    );
    const projectLabelsByProjectId = useMemo(
        () => new Map(visProjects.map(project => [project.id, project.labels ?? []])),
        [visProjects]
    );
    const activeSettingsProject = useMemo(() => visProjects.find(p => p.id === settingsProjectId) ?? null, [visProjects, settingsProjectId]);

    const showEvents = nav.section === "all" || nav.section === "events";
    const showTasksOnGrid = nav.section === "all" || nav.section === "tasks";
    const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | null>(null);
    useEffect(() => {
        if (typeof window === "undefined") return;
        let active = true;
        const readAvatar = async () => {
            const fromLocal = window.localStorage.getItem(AVATAR_STORAGE_KEY);
            if (fromLocal) {
                if (active) setCurrentUserAvatarUrl(fromLocal);
                return;
            }
            if (!runtime?.localStore) {
                if (active) setCurrentUserAvatarUrl(null);
                return;
            }
            const fromStore = await runtime.localStore.get(AVATAR_STORE_NAMESPACE, AVATAR_STORE_KEY).catch(() => null);
            const next = typeof fromStore === "string" && fromStore ? fromStore : null;
            if (next) window.localStorage.setItem(AVATAR_STORAGE_KEY, next);
            if (active) setCurrentUserAvatarUrl(next);
        };
        void readAvatar();
        return () => { active = false; };
    }, [runtime]);
    const assigneeOptions = useMemo(() => {
        const ids = new Set<string>();
        if (userId) ids.add(userId);
        for (const task of tsk.tasks) if (task.assigneeId) ids.add(task.assigneeId);
        return [...ids].map(id => ({
            id,
            label: id === userId ? "Me" : id,
            avatarUrl: id === userId ? currentUserAvatarUrl : null,
            initial: (id === userId ? "M" : id.trim().charAt(0).toUpperCase()) || "U",
        }));
    }, [tsk.tasks, userId, currentUserAvatarUrl]);
    const assigneeById = useMemo(
        () => new Map(assigneeOptions.map(opt => [opt.id, { label: opt.label, avatarUrl: opt.avatarUrl, initial: opt.initial }])),
        [assigneeOptions]
    );

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(PLAN_VIEW_STORAGE_KEY, JSON.stringify({ nav, focusDate: focusDate.toISOString() }));
    }, [nav, focusDate]);

    useEffect(() => {
        if (tsk.loading || cal.loading) return;
        setNav(current => {
            const nextProjectId = current.projectId && visProjects.some(p => p.id === current.projectId) ? current.projectId : null;
            const nextCalendarId = current.calendarId && cal.sources.some(s => s.id === current.calendarId) ? current.calendarId : null;
            const nextView = clampView(current.view, current.section, nextProjectId);
            if (nextProjectId === current.projectId && nextCalendarId === current.calendarId && nextView === current.view) return current;
            return { ...current, projectId: nextProjectId, calendarId: nextCalendarId, view: nextView };
        });
    }, [visProjects, cal.sources, tsk.loading, cal.loading]);

    useEffect(() => {
        if (nav.section === "tasks" && nav.projectId === null && nav.view === "kanban") {
            setNav(current => ({ ...current, view: "calendar" }));
        }
    }, [nav.section, nav.projectId, nav.view]);

    useEffect(() => {
        if (selectedTaskId && !selectedTask) setSelectedTaskId(null);
    }, [selectedTaskId, selectedTask]);
    useEffect(() => {
        if ((nav.view === "calendar" || nav.view === "list" || nav.view === "link") && selectedTaskId) {
            setSelectedTaskId(null);
        }
    }, [nav.view, selectedTaskId]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onSelectTask = (event: Event) => {
            const detail = (event as CustomEvent<PlanSelectTaskDetail>).detail;
            if (!detail?.taskId) return;
            setSelectedTaskId(detail.taskId);
            setSettingsProjectId(null);
            setNav(current => {
                const nextProjectId = detail.projectId ?? current.projectId;
                const nextSection = "tasks";
                const nextView = clampView(current.view, nextSection, nextProjectId);
                return {
                    ...current,
                    section: nextSection,
                    projectId: nextProjectId,
                    view: nextView,
                };
            });
        };
        window.addEventListener(PLAN_SELECT_TASK_EVENT, onSelectTask);
        return () => window.removeEventListener(PLAN_SELECT_TASK_EVENT, onSelectTask);
    }, []);
    // fix 6: open left panel even when hidden
    const hideLeftSidebar = useCallback(() => {
        dispatchLayoutPanelsApply({ feature: "ground", left: false, right: readFeaturePanelState("ground").right });
    }, []);

    const closeNewTaskPanel = useCallback(() => {
        setLeftPanel(null);
        hideLeftSidebar();
    }, [hideLeftSidebar]);

    const closeNewEventPanel = useCallback(() => {
        setLeftPanel(null);
        hideLeftSidebar();
    }, [hideLeftSidebar]);

    const handleCreateTask = (defaultStateId: string | null = null) => {
        setSettingsProjectId(null);
        dispatchLayoutPanelsApply({ feature: "ground", left: true, right: readFeaturePanelState("ground").right });
        setLeftPanel({ mode: "new-task", defaultStateId });
    };

    const handleCreateEvent = (defaultCalendarId: string | null = null) => {
        setSettingsProjectId(null);
        dispatchLayoutPanelsApply({ feature: "ground", left: true, right: readFeaturePanelState("ground").right });
        setLeftPanel({ mode: "new-event", defaultCalendarId });
    };
    const wouldCreateParentCycle = useCallback((childId: string, nextParentId: string | null): boolean => {
        let cursor = nextParentId;
        const seen = new Set<string>();
        while (cursor) {
            if (cursor === childId) return true;
            if (seen.has(cursor)) break;
            seen.add(cursor);
            cursor = activeTaskById.get(cursor)?.childOfTaskId ?? null;
        }
        return false;
    }, [activeTaskById]);
    const wouldCreateDuplicateCycle = useCallback((sourceId: string, nextDuplicateOfId: string | null): boolean => {
        let cursor = nextDuplicateOfId;
        const seen = new Set<string>();
        while (cursor) {
            if (cursor === sourceId) return true;
            if (seen.has(cursor)) break;
            seen.add(cursor);
            cursor = activeTaskById.get(cursor)?.duplicateOfTaskId ?? null;
        }
        return false;
    }, [activeTaskById]);
    const applyTaskRelation = useCallback(async (sourceTaskId: string, kind: TaskRelationKind, targetTaskId: string): Promise<string | null> => {
        const source = activeTaskById.get(sourceTaskId);
        const target = activeTaskById.get(targetTaskId);
        if (!source || !target) return "Task not found.";
        if (source.id === target.id) return "Task relation cannot point to itself.";
        if (source.projectId !== target.projectId) return "Relation must reference task in the same project.";
        if (kind === "child_of") {
            if (wouldCreateParentCycle(source.id, target.id)) return "Cannot create parent/child cycle.";
            await tsk.updateTask(source.id, { childOfTaskId: target.id });
            return null;
        }
        if (kind === "parent_of") {
            if (wouldCreateParentCycle(target.id, source.id)) return "Cannot create parent/child cycle.";
            await tsk.updateTask(target.id, { childOfTaskId: source.id });
            return null;
        }
        if (kind === "blocked_by") {
            const next = [...new Set([...(source.blockedByTaskIds ?? []), target.id])];
            await tsk.updateTask(source.id, { blockedByTaskIds: next });
            return null;
        }
        if (kind === "blocking") {
            const next = [...new Set([...(target.blockedByTaskIds ?? []), source.id])];
            await tsk.updateTask(target.id, { blockedByTaskIds: next });
            return null;
        }
        if (wouldCreateDuplicateCycle(source.id, target.id)) return "Cannot create duplicate cycle.";
        await tsk.updateTask(source.id, { duplicateOfTaskId: target.id });
        return null;
    }, [activeTaskById, tsk, wouldCreateDuplicateCycle, wouldCreateParentCycle]);
    const removeTaskRelation = useCallback(async (sourceTaskId: string, kind: TaskRelationKind, targetTaskId: string | null): Promise<void> => {
        const source = activeTaskById.get(sourceTaskId);
        if (!source) return;
        if (kind === "child_of") {
            await tsk.updateTask(source.id, { childOfTaskId: null });
            return;
        }
        if (kind === "parent_of") {
            if (!targetTaskId) return;
            const child = activeTaskById.get(targetTaskId);
            if (!child || child.childOfTaskId !== source.id) return;
            await tsk.updateTask(child.id, { childOfTaskId: null });
            return;
        }
        if (kind === "blocked_by") {
            if (!targetTaskId) return;
            await tsk.updateTask(source.id, { blockedByTaskIds: (source.blockedByTaskIds ?? []).filter(id => id !== targetTaskId) });
            return;
        }
        if (kind === "blocking") {
            if (!targetTaskId) return;
            const blocked = activeTaskById.get(targetTaskId);
            if (!blocked) return;
            await tsk.updateTask(blocked.id, { blockedByTaskIds: (blocked.blockedByTaskIds ?? []).filter(id => id !== source.id) });
            return;
        }
        await tsk.updateTask(source.id, { duplicateOfTaskId: null });
    }, [activeTaskById, tsk]);
    const updateTaskQuick = useCallback(
        async (taskId: string, patch: Partial<Pick<Task, "priority" | "assigneeId" | "tags">>) => {
            await tsk.updateTask(taskId, patch);
        },
        [tsk]
    );
    const renameTask = useCallback(
        async (taskId: string, title: string) => {
            await tsk.updateTask(taskId, { title: title.trim() || "Untitled" });
        },
        [tsk]
    );
    const duplicateTask = useCallback(
        async (task: Task) => {
            await tsk.createTask({
                projectId: task.projectId,
                stateId: task.stateId,
                parentTaskId: task.parentTaskId,
                childOfTaskId: task.childOfTaskId,
                blockedByTaskIds: task.blockedByTaskIds,
                duplicateOfTaskId: task.duplicateOfTaskId,
                title: `${task.title || "Task"} (copy)`,
                description: task.description,
                tags: task.tags,
                priority: task.priority,
                dueDate: task.dueDate,
                assigneeId: task.assigneeId,
            });
        },
        [tsk]
    );
    const deleteTask = useCallback(
        async (taskId: string) => {
            await tsk.deleteTask(taskId);
            if (selectedTaskId === taskId) setSelectedTaskId(null);
        },
        [selectedTaskId, tsk]
    );
    const openTaskContextMenu = useCallback((taskId: string, x: number, y: number) => {
        setTaskContextMenu({ taskId, x, y });
    }, []);
    const contextTask = useMemo(
        () => (taskContextMenu ? activeTaskById.get(taskContextMenu.taskId) ?? null : null),
        [activeTaskById, taskContextMenu]
    );
    const contextTaskRelationTargets = useMemo(
        () =>
            contextTask
                ? activeTasks.filter(
                    task => task.projectId === contextTask.projectId && task.id !== contextTask.id
                )
                : [],
        [activeTasks, contextTask]
    );
    useEffect(() => {
        if (!taskContextMenu) return;
        if (!contextTask) {
            setTaskContextMenu(null);
            return;
        }
        if (nav.view !== "list" && nav.view !== "gantt") {
            setTaskContextMenu(null);
        }
    }, [contextTask, nav.view, taskContextMenu]);

    const handleAddProject = async () => { await tsk.createProject("New Project"); };
    const handleDeleteCalendar = async (id: string) => {
        cal.deleteSource(id);
        if (nav.calendarId === id) setNav(n => ({ ...n, calendarId: null }));
    };
    const handleDeleteProject = async (id: string) => {
        await tsk.deleteProject(id);
        if (nav.projectId === id) setNav(n => ({ ...n, projectId: null }));
    };
    const handleAddCalendarInternal = () => { cal.addInternalCalendar(); };
    const handleAddCalendarExternalGoogle = () => { void navigate({ to: "/settings", search: { section: "integrations" } }); };
    const handleAddCalendarExternalMicrosoft = () => { void navigate({ to: "/settings", search: { section: "integrations" } }); };
    const handleAddCalendarExternalApple = () => { void navigate({ to: "/settings", search: { section: "integrations" } }); };
    const handleOpenProjectSettings = (projectId: string) => {
        setLeftPanel(null);
        setSettingsSection("general");
        setSettingsProjectId(projectId);
        dispatchLayoutPanelsApply({ feature: "ground", left: true, right: readFeaturePanelState("ground").right });
    };

    const navProps: PlanNavProps = {
        state: nav,
        onChange: setNav,
        onCreateEvent: handleCreateEvent,
        onCreateTask: handleCreateTask,
        onAddProject: handleAddProject,
        onDeleteCalendar: handleDeleteCalendar,
        onDeleteProject: handleDeleteProject,
        onOpenProjectSettings: handleOpenProjectSettings,
        onAddCalendarInternal: handleAddCalendarInternal,
        onAddCalendarExternalGoogle: handleAddCalendarExternalGoogle,
        onAddCalendarExternalMicrosoft: handleAddCalendarExternalMicrosoft,
        onAddCalendarExternalApple: handleAddCalendarExternalApple,
        onNavigate: handleNavigate,
        sources: cal.sources,
        projects: visProjects,
    };

    // left panel contents
    const leftContent = settingsProjectId && activeSettingsProject ? (
        <ProjectSettingsNav
            projectName={activeSettingsProject.name}
            logoUrl={activeSettingsProject.logoUrl}
            section={settingsSection}
            onSelect={setSettingsSection}
            onBack={() => setSettingsProjectId(null)}
        />
    ) : leftPanel?.mode === "new-event" ? (
        <NewEventPanel
            key={`new-event:${leftPanel.defaultCalendarId ?? "auto"}`}
            sources={cal.sources}
            defaultCalendarId={leftPanel.defaultCalendarId}
            onCancel={closeNewEventPanel}
            onSubmit={(args) => {
                cal.createEvent({
                    title: args.title,
                    description: args.description,
                    location: args.location,
                    startTime: args.startTime,
                    endTime: args.endTime,
                    allDay: args.allDay,
                    calendarId: args.calendarId,
                    color: args.color,
                    reminders: [],
                });
                closeNewEventPanel();
            }}
        />
    ) : leftPanel?.mode === "new-task" ? (
        <NewTaskPanel
            key={`new-task:${nav.projectId ?? "all"}:${leftPanel.defaultStateId ?? "none"}`}
            states={visStates}
            projects={visProjects}
            defaultProjectId={nav.projectId ?? visProjects[0]?.id ?? null}
            defaultStateId={leftPanel.defaultStateId}
            forceProjectSelect={nav.projectId === null && (nav.section === "all" || nav.section === "tasks")}
            assigneeOptions={assigneeOptions}
            defaultAssigneeId={userId ?? null}
            canEdit={tsk.canEdit}
            onCancel={closeNewTaskPanel}
            onSubmit={async (args) => tsk.createTask(args)}
        />
    ) : null;

    // center content
    const center = (
        <div className="flex flex-col h-full min-h-0">
            {!settingsProjectId && <PlanNav {...navProps} />}
            <div className="flex-1 min-h-0">
                {settingsProjectId && activeSettingsProject && settingsSection === "general" && (
                    <ProjectSettingsGeneral
                        projectName={activeSettingsProject.name}
                        logoUrl={activeSettingsProject.logoUrl}
                        onRename={async (name) => {
                            await tsk.updateProject(activeSettingsProject.id, { name });
                        }}
                        onSetLogo={(logo) => { void tsk.updateProject(activeSettingsProject.id, { logoUrl: logo }); }}
                    />
                )}
                {settingsProjectId && activeSettingsProject && settingsSection === "stages" && (
                    <ProjectSettingsStages
                        projectId={activeSettingsProject.id}
                        states={tsk.states}
                        tasks={tsk.tasks}
                        canEdit={tsk.canEdit}
                        onCreateStage={async ({ name, icon, color }) => tsk.createWorkflowState(activeSettingsProject.id, name, "custom", color, icon)}
                        onUpdateStage={(stageId, patch) => tsk.updateWorkflowState(stageId, patch)}
                        onDeleteStage={(stageId) => tsk.deleteWorkflowState(stageId)}
                        onDeleteTask={(taskId) => tsk.deleteTask(taskId)}
                    />
                )}
                {settingsProjectId && activeSettingsProject && settingsSection === "labels" && (
                    <ProjectSettingsLabels
                        labels={activeSettingsProject.labels ?? []}
                        canEdit={tsk.canEdit}
                        onSaveLabels={async labels => {
                            await tsk.updateProject(activeSettingsProject.id, { labels });
                        }}
                    />
                )}
                {!settingsProjectId && (
                    <>
                {nav.view === "calendar" && (
                    <PlanCalendarView
                        density={nav.density}
                        currentDate={focusDate}
                        events={filteredEvents}
                        tasks={filteredTasks}
                        taskStates={visStates}
                        sources={cal.sources}
                        showEvents={showEvents}
                        showTasks={showTasksOnGrid}
                        onClickEvent={id => cal.selectEvent(id)}
                        onSelectTask={handleSelectTask}
                    />
                )}
                {nav.view === "list" && (
                    <ListView events={filteredEvents} tasks={filteredTasks} taskStates={visStates}
                        sources={cal.sources} showEvents={showEvents} showTasks={showTasksOnGrid}
                        onClickEvent={id => cal.selectEvent(id)} onSelectTask={handleSelectTask}
                        onOpenTaskContextMenu={openTaskContextMenu} />
                )}
                {nav.view === "link" && <LinkView events={visEvents} sources={cal.sources} />}
                {/* fix 5: require a project for kanban */}
                {nav.view === "kanban" && !nav.projectId && (
                    <div className="flex flex-col h-full items-center justify-center gap-3 text-center">
                        <div className="text-[#222] text-[11px]">Select a project to use Kanban view.</div>
                        {visProjects.length > 0 && (
                            <div className="flex flex-wrap justify-center gap-1.5">
                                {visProjects.slice(0, 6).map(p => (
                                    <button key={p.id} onClick={() => setNav(n => ({ ...n, projectId: p.id }))}
                                        className="px-3 py-1.5 rounded-lg border border-[#1e1e1e] text-[11px] text-[#555] hover:text-[#ccc] hover:bg-[#141414] transition-colors">
                                        {p.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {nav.view === "kanban" && !!nav.projectId && selectedTask && (
                    <TaskDetailsView
                        task={selectedTask}
                        projectName={projectNameById.get(selectedTask.projectId) ?? "Project"}
                        states={visStates}
                        projectLabels={(visProjects.find(p => p.id === selectedTask.projectId)?.labels ?? [])}
                        comments={tsk.comments}
                        activities={tsk.activities}
                        assigneeOptions={assigneeOptions}
                        assigneeById={assigneeById}
                        currentUserId={userId}
                        canEdit={tsk.canEdit}
                        onBack={() => setSelectedTaskId(null)}
                        onSave={async patch => {
                            await tsk.updateTask(selectedTask.id, patch);
                        }}
                        relationTargets={selectedTaskRelationTargets}
                        relations={selectedTaskRelations}
                        onApplyRelation={async (kind, targetTaskId) => applyTaskRelation(selectedTask.id, kind, targetTaskId)}
                        onRemoveRelation={async (kind, targetTaskId) => { await removeTaskRelation(selectedTask.id, kind, targetTaskId); }}
                        onDelete={async () => {
                            await tsk.deleteTask(selectedTask.id);
                        }}
                        onAddComment={async (body) => { await tsk.addComment(selectedTask.id, body); }}
                    />
                )}
                {nav.view === "kanban" && !!nav.projectId && !selectedTask && (
                    <KanbanView states={visStates} tasks={filteredTasks} selectedTaskId={selectedTaskId}
                        projectId={nav.projectId} canEdit={tsk.canEdit}
                        assigneeById={assigneeById}
                        assigneeOptions={assigneeOptions}
                        projectLabelColorsByProjectId={projectLabelColorsByProjectId}
                        projectLabelsByProjectId={projectLabelsByProjectId}
                        onQuickUpdateTask={updateTaskQuick}
                        onRenameTask={renameTask}
                        onDuplicateTask={duplicateTask}
                        onDeleteTask={deleteTask}
                        onApplyRelation={applyTaskRelation}
                        onSelectTask={handleSelectTask}
                        onMoveTask={(taskId, stateId, beforeTaskId) => void tsk.moveTask(taskId, null, stateId, beforeTaskId ?? null)}
                        onRequestCreateTask={stateId => handleCreateTask(stateId)} />
                )}
                {nav.view === "gantt" && (
                    <GanttView tasks={filteredTasks} selectedTaskId={selectedTaskId} projectNameById={projectNameById} assigneeById={assigneeById} showProjectName={nav.projectId === null} onSelectTask={handleSelectTask} onOpenTaskContextMenu={openTaskContextMenu} />
                )}
                <KanbanTaskContextModal
                    open={!!taskContextMenu}
                    task={contextTask}
                    x={taskContextMenu?.x ?? 0}
                    y={taskContextMenu?.y ?? 0}
                    canEdit={tsk.canEdit}
                    assigneeOptions={assigneeOptions}
                    projectLabels={contextTask ? (projectLabelsByProjectId.get(contextTask.projectId) ?? []) : []}
                    relationTargets={contextTaskRelationTargets}
                    onClose={() => setTaskContextMenu(null)}
                    onUpdateTask={updateTaskQuick}
                    onRenameTask={renameTask}
                    onDuplicateTask={duplicateTask}
                    onDeleteTask={deleteTask}
                    onApplyRelation={applyTaskRelation}
                />
                    </>
                )}
            </div>
        </div>
    );

    return (
        <FeaturePanelsShell
            feature="ground"
            left={leftContent ?? undefined}
            center={center}
            right={undefined}
        />
    );
}
