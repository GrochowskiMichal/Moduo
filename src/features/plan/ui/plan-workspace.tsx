import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCalendar } from "../../calendar/hooks/use-calendar";
import { useTasks } from "../../tasks/hooks/use-tasks";
import type { CalendarEvent } from "../../calendar/types";
import type { Task, TaskPriority, TaskWorkflowState } from "../../tasks/types";
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

// ─── constants / helpers ──────────────────────────────────────────────────────
const AVATAR_STORAGE_KEY = "moduo:auth-avatar-preview-v1";
const AVATAR_STORE_NAMESPACE = "auth_ui";
const AVATAR_STORE_KEY = "avatar_preview_v1";
const PLAN_VIEW_STORAGE_KEY = "moduo:plan:view-v1";

function defaultStageVisual(kind: string): { icon: string; color: string } {
    if (kind === "todo") return { icon: "◯", color: "#C9CED6" };
    if (kind === "in_progress") return { icon: "◔", color: "#F5A524" };
    if (kind === "done") return { icon: "◉", color: "#2DD4BF" };
    if (kind === "in_review") return { icon: "◑", color: "#60A5FA" };
    if (kind === "backlog") return { icon: "◇", color: "#9CA3AF" };
    if (kind === "canceled") return { icon: "⨯", color: "#EF4444" };
    return { icon: "◯", color: "#8E8E8E" };
}

const STAGE_KIND_RANK: Record<string, number> = {
    backlog: 0,
    todo: 1,
    in_progress: 2,
    in_review: 3,
    done: 4,
    canceled: 5,
    custom: 6,
};

function stagePositionOrder(position: string): number {
    const m = position.match(/(\d+)\s*$/);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

function compareStages(a: TaskWorkflowState, b: TaskWorkflowState): number {
    const po = stagePositionOrder(a.position) - stagePositionOrder(b.position);
    if (po !== 0) return po;
    const ko = (STAGE_KIND_RANK[a.kind] ?? 99) - (STAGE_KIND_RANK[b.kind] ?? 99);
    if (ko !== 0) return ko;
    return a.name.localeCompare(b.name);
}

function readSavedPlanView(): { nav: PlanNavState; focusDate: Date } | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(PLAN_VIEW_STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as { nav?: Partial<PlanNavState>; focusDate?: string };
        const nextNav: PlanNavState = {
            section: parsed.nav?.section === "events" || parsed.nav?.section === "tasks" ? parsed.nav.section : "all",
            view: parsed.nav?.view === "gantt" || parsed.nav?.view === "kanban" || parsed.nav?.view === "link" || parsed.nav?.view === "list" ? parsed.nav.view : "calendar",
            density: parsed.nav?.density === "day" || parsed.nav?.density === "month" ? parsed.nav.density : "week",
            calendarId: typeof parsed.nav?.calendarId === "string" ? parsed.nav.calendarId : null,
            projectId: typeof parsed.nav?.projectId === "string" ? parsed.nav.projectId : null,
        };
        nextNav.view = clampView(nextNav.view, nextNav.section, nextNav.projectId);
        const dt = parsed.focusDate ? new Date(parsed.focusDate) : new Date();
        return { nav: nextNav, focusDate: Number.isNaN(dt.getTime()) ? new Date() : dt };
    } catch {
        return null;
    }
}


function ProjectAvatar({ name, logoUrl, size = 14 }: { name: string; logoUrl?: string | null; size?: number }) {
    if (!logoUrl) return null;
    return (
        <span
            className="rounded-[8px] border border-[#252525] bg-[#1a1a1a] p-[4px] overflow-hidden grid place-items-center shrink-0"
            style={{ width: size, height: size }}
        >
            <img src={logoUrl} alt={name} className="h-full w-full rounded-[6px] object-cover" />
        </span>
    );
}

function LabelsSelector({
    labels,
    selected,
    onToggle,
}: {
    labels: Array<{ name: string; color: string }>;
    selected: string[];
    onToggle: (name: string) => void;
}) {
    if (!labels.length) {
        return <div className="text-[10px] text-[#555]">No project labels configured.</div>;
    }
    const selectedSet = new Set(selected);
    return (
        <div className="flex flex-wrap gap-1.5">
            {labels.map(label => {
                const active = selectedSet.has(label.name);
                return (
                    <button
                        key={label.name}
                        type="button"
                        onClick={() => onToggle(label.name)}
                        className={`px-2 py-1 rounded-md border text-[10px] transition-colors ${active ? "text-[#f1f1f1]" : "text-[#8f8f8f] hover:text-[#d8d8d8]"}`}
                        style={{ borderColor: `${label.color}${active ? "" : "55"}`, background: active ? `${label.color}22` : "#0f0f0f" }}
                    >
                        {label.name}
                    </button>
                );
            })}
        </div>
    );
}

// ─── new task left panel ───────────────────────────────────────────────────────
function NewTaskPanel({ states, projects, defaultProjectId, defaultStateId, canEdit, forceProjectSelect = false, assigneeOptions, defaultAssigneeId, onSubmit, onCreated, onCancel }: {
    states: TaskWorkflowState[]; projects: import("../../tasks/types").TaskProject[];
    defaultProjectId: string | null; defaultStateId: string | null; canEdit: boolean;
    forceProjectSelect?: boolean;
    assigneeOptions: Array<{ id: string; label: string; avatarUrl: string | null; initial: string }>;
    defaultAssigneeId: string | null;
    onSubmit: (args: { projectId: string; stateId: string | null; title: string; description: string; tags: string[]; priority: TaskPriority; dueDate: string | null; assigneeId: string | null }) => Promise<string | null>;
    onCreated?: (taskId: string) => void;
    onCancel: () => void;
}) {
    const assigneeRef = useRef<HTMLDivElement>(null);
    const [assigneeOpen, setAssigneeOpen] = useState(false);
    const projectRef = useRef<HTMLDivElement>(null);
    const [projectOpen, setProjectOpen] = useState(false);
    const stageRef = useRef<HTMLDivElement>(null);
    const [stageOpen, setStageOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
    const [priority, setPriority] = useState<TaskPriority>(2);
    const [dueDate, setDueDate] = useState("");
    const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? "");
    const [createMore, setCreateMore] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const projStates = states.filter(s => !s.deletedAt && s.projectId === projectId);
    const projectLabels = projects.find(p => p.id === projectId)?.labels ?? [];
    projStates.sort(compareStages);
    const [stateId, setStateId] = useState<string>(() => {
        if (defaultStateId && projStates.some(s => s.id === defaultStateId)) return defaultStateId;
        return projStates[0]?.id ?? "";
    });

    useEffect(() => {
        if (defaultStateId && projStates.some(s => s.id === defaultStateId)) {
            setStateId(defaultStateId);
            return;
        }
        setStateId(projStates[0]?.id ?? "");
    }, [projectId, defaultStateId, projStates]);
    useEffect(() => {
        const allowed = new Set((projects.find(p => p.id === projectId)?.labels ?? []).map(label => label.name));
        setTags(prev => prev.filter(tag => allowed.has(tag)));
    }, [projectId, projects]);
    useEffect(() => {
        if (!assigneeOpen) return;
        const onDown = (e: MouseEvent) => {
            if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) setAssigneeOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [assigneeOpen]);
    useEffect(() => {
        if (!projectOpen) return;
        const onDown = (e: MouseEvent) => {
            if (projectRef.current && !projectRef.current.contains(e.target as Node)) setProjectOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [projectOpen]);
    useEffect(() => {
        if (!stageOpen) return;
        const onDown = (e: MouseEvent) => {
            if (stageRef.current && !stageRef.current.contains(e.target as Node)) setStageOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [stageOpen]);

    const submit = async () => {
        if (!title.trim() || !projectId || submitting) return;
        setSubmitting(true);
        try {
            const createdId = await onSubmit({
                projectId,
                stateId: stateId || null,
                title: title.trim(),
                description: description.trim(),
                tags,
                priority,
                dueDate: dueDate || null,
                assigneeId: assigneeId || null,
            });
            if (createdId) {
                onCreated?.(createdId);
                if (createMore) {
                    setTitle("");
                    setDescription("");
                    setTags([]);
                    setDueDate("");
                } else {
                    onCancel();
                }
            }
        }
        finally { setSubmitting(false); }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-bold text-[#ccc]">New Task</span>
                <button onClick={onCancel} className="h-5 w-5 grid place-items-center rounded text-[#333] hover:text-[#888] hover:bg-[#1a1a1a] transition-colors">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>

            <div className="flex flex-col gap-3 flex-1">
                <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
                    placeholder="Task title…"
                    className="w-full bg-transparent text-[13px] font-bold text-[#ddd] outline-none placeholder:text-[#2a2a2a] border-b border-[#1a1a1a] pb-2" />

                <div className="flex flex-col gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-[#222]">Description</span>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
                        className="bg-[#111] border border-[#181818] rounded-lg px-2 py-1.5 text-[10px] text-[#bbb] outline-none resize-none placeholder:text-[#333]"
                        placeholder="Task description…" />
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-[#222]">Labels</span>
                    <LabelsSelector
                        labels={projectLabels}
                        selected={tags}
                        onToggle={(name) => setTags(prev => prev.includes(name) ? prev.filter(tag => tag !== name) : [...prev, name])}
                    />
                </div>

                {(forceProjectSelect || projects.length > 1) && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-[#222]">Project</span>
                        <div ref={projectRef} className="relative">
                            <button onClick={() => setProjectOpen(v => !v)} className="w-full bg-[#111] border border-[#181818] rounded-lg px-2 py-1.5 text-[10px] text-[#bbb] outline-none flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ProjectAvatar
                                        name={(projects.find(p => p.id === projectId)?.name ?? "Project")}
                                        logoUrl={projects.find(p => p.id === projectId)?.logoUrl ?? null}
                                    />
                                    <span>{projects.find(p => p.id === projectId)?.name ?? "Project"}</span>
                                </div>
                                <span className="text-[#555]">▾</span>
                            </button>
                            {projectOpen && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-[#1e1e1e] bg-[#0f0f0f] py-1 max-h-44 overflow-y-auto">
                                    {projects.filter(p => !p.deletedAt).map(p => (
                                        <button key={p.id} onClick={() => { setProjectId(p.id); setProjectOpen(false); }} className="w-full px-2 py-1.5 text-left text-[10px] text-[#bbb] hover:bg-[#151515] flex items-center gap-2">
                                            <ProjectAvatar name={p.name} logoUrl={p.logoUrl ?? null} />
                                            <span>{p.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {projStates.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-[#222]">Stage</span>
                        <div ref={stageRef} className="relative">
                            <button onClick={() => setStageOpen(v => !v)} className="w-full bg-[#111] border border-[#181818] rounded-lg px-2 py-1.5 text-[10px] text-[#bbb] outline-none flex items-center justify-between">
                                {(() => {
                                    const current = projStates.find(s => s.id === stateId) ?? null;
                                    const fallback = current ? defaultStageVisual(current.kind) : null;
                                    return (
                                        <span className="flex items-center gap-2">
                                            <span style={{ color: current?.color || fallback?.color || "#8E8E8E" }}>{current?.icon || fallback?.icon || "◯"}</span>
                                            <span>{current?.name ?? "Stage"}</span>
                                        </span>
                                    );
                                })()}
                                <span className="text-[#555]">▾</span>
                            </button>
                            {stageOpen && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-[#1e1e1e] bg-[#0f0f0f] py-1 max-h-44 overflow-y-auto">
                                    {projStates.map(s => {
                                        const fallback = defaultStageVisual(s.kind);
                                        return (
                                            <button key={s.id} onClick={() => { setStateId(s.id); setStageOpen(false); }} className="w-full px-2 py-1.5 text-left text-[10px] text-[#bbb] hover:bg-[#151515] flex items-center gap-2">
                                                <span style={{ color: s.color || fallback.color }}>{s.icon || fallback.icon}</span>
                                                <span>{s.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-[#222]">Priority</span>
                    <select value={priority} onChange={e => setPriority(Number(e.target.value) as TaskPriority)}
                        className="bg-[#111] border border-[#181818] rounded-lg px-2 py-1.5 text-[10px] text-[#888] outline-none w-full [color-scheme:dark]">
                        {[["Urgent", 0], ["High", 1], ["Medium", 2], ["Low", 3], ["None", 4]].map(([l, v]) => <option key={v} value={Number(v)} className="bg-[#0e0e0e]">{l}</option>)}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-[#222]">Due date</span>
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                        className="bg-[#111] border border-[#181818] rounded-lg px-2 py-1.5 text-[10px] text-[#888] outline-none w-full [color-scheme:dark]" />
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-[#222]">Assignee</span>
                    <div ref={assigneeRef} className="relative">
                        <button onClick={() => setAssigneeOpen(o => !o)} className="w-full bg-[#111] border border-[#181818] rounded-lg px-2 py-1.5 text-[10px] text-[#bbb] outline-none flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {assigneeId ? (
                                    (() => {
                                        const current = assigneeOptions.find(opt => opt.id === assigneeId);
                                        if (!current) return <span className="text-[#888]">Unassigned</span>;
                                        return (
                                            <>
                                                <span className="h-5 w-5 rounded-full border border-[#2c2c2c] bg-[#1a1a1a] overflow-hidden grid place-items-center">
                                                    {current.avatarUrl ? <img src={current.avatarUrl} alt={current.label} className="h-full w-full object-cover" /> : <span className="text-[8px] font-bold text-[#bdbdbd]">{current.initial}</span>}
                                                </span>
                                                <span>{current.label}</span>
                                            </>
                                        );
                                    })()
                                ) : (
                                    <span className="text-[#888]">Unassigned</span>
                                )}
                            </div>
                            <span className="text-[#555]">▾</span>
                        </button>
                        {assigneeOpen && (
                            <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-[#1e1e1e] bg-[#0f0f0f] py-1 max-h-44 overflow-y-auto">
                                <button onClick={() => { setAssigneeId(""); setAssigneeOpen(false); }} className="w-full px-2 py-1.5 text-left text-[10px] text-[#888] hover:bg-[#151515]">Unassigned</button>
                                {assigneeOptions.map(opt => (
                                    <button key={opt.id} onClick={() => { setAssigneeId(opt.id); setAssigneeOpen(false); }} className="w-full px-2 py-1.5 text-left text-[10px] text-[#bbb] hover:bg-[#151515] flex items-center gap-2">
                                        <span className="h-5 w-5 rounded-full border border-[#2c2c2c] bg-[#1a1a1a] overflow-hidden grid place-items-center">
                                            {opt.avatarUrl ? <img src={opt.avatarUrl} alt={opt.label} className="h-full w-full object-cover" /> : <span className="text-[8px] font-bold text-[#bdbdbd]">{opt.initial}</span>}
                                        </span>
                                        <span>{opt.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
                <button onClick={() => void submit()} disabled={!title.trim() || submitting || !canEdit}
                    className="flex-1 py-2 rounded-xl bg-[#2a2a2a] text-[#f1f1f1] text-[11px] font-bold hover:bg-[#353535] transition-colors disabled:opacity-30 disabled:pointer-events-none">
                    {submitting ? "Creating…" : "Create Task"}
                </button>
                <button
                    type="button"
                    onClick={() => setCreateMore(v => !v)}
                    className="flex items-center gap-2 text-[11px] text-[#9a9a9a] hover:text-[#ccc] transition-colors"
                >
                    <span className={`relative inline-flex h-5 w-9 rounded-full border transition-colors ${createMore ? "bg-[#2a2a2a] border-[#3a3a3a]" : "bg-[#1b1b1b] border-[#2a2a2a]"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#e2e2e2] transition-transform ${createMore ? "translate-x-4" : "translate-x-0.5"}`} />
                    </span>
                    <span>Create more</span>
                </button>
            </div>
        </div>
    );
}

// ─── main workspace ───────────────────────────────────────────────────────────
export function PlanWorkspace() {
    const { runtime, userId } = useAuth();
    const { selectedWorkspaceId, modulePermissions } = useWorkspace();

    const cal = useCalendar();
    const tsk = useTasks(runtime, { userId, workspaceId: selectedWorkspaceId, modulePermission: modulePermissions.tasks });

    const savedView = readSavedPlanView();
    const [nav, setNav] = useState<PlanNavState>(savedView?.nav ?? { section: "all", view: "calendar", density: "week", calendarId: null, projectId: null });
    const [leftPanel, setLeftPanel] = useState<{ mode: "new-task"; defaultStateId: string | null } | null>(null);
    const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
    const [settingsSection, setSettingsSection] = useState<"general" | "stages" | "labels">("general");
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const handleSelectTask = (id: string) => setSelectedTaskId(id);

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
    const selectedTask = useMemo(
        () => (selectedTaskId ? filteredTasks.find(t => t.id === selectedTaskId) ?? null : null),
        [filteredTasks, selectedTaskId]
    );
    const projectNameById = useMemo(() => new Map(visProjects.map(p => [p.id, p.name])), [visProjects]);
    const projectLabelColorsByProjectId = useMemo(
        () => new Map(visProjects.map(project => [project.id, new Map((project.labels ?? []).map(label => [label.name, label.color]))])),
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
        dispatchLayoutPanelsApply({ feature: "plan", left: false, right: readFeaturePanelState("plan").right });
    }, []);

    const closeNewTaskPanel = useCallback(() => {
        setLeftPanel(null);
        hideLeftSidebar();
    }, [hideLeftSidebar]);

    const handleCreateTask = (defaultStateId: string | null = null) => {
        setSettingsProjectId(null);
        dispatchLayoutPanelsApply({ feature: "plan", left: true, right: readFeaturePanelState("plan").right });
        setLeftPanel({ mode: "new-task", defaultStateId });
    };
    const handleCreateEvent = () => {
        const src = cal.sources.find(s => s.visible);
        if (!src) return;
        const now = new Date(); now.setMinutes(0, 0, 0);
        const end = new Date(now); end.setHours(end.getHours() + 1);
        cal.createEvent({ title: "New Event", description: "", location: "", startTime: now.toISOString(), endTime: end.toISOString(), allDay: false, calendarId: src.id, color: src.color ?? "#888", reminders: [] });
    };

    const handleAddProject = async () => { await tsk.createProject("New Project"); };
    const handleDeleteProject = async (id: string) => {
        await tsk.deleteProject(id);
        if (nav.projectId === id) setNav(n => ({ ...n, projectId: null }));
    };
    const handleAddCalendar = () => { void cal.addGoogleAccount(); };
    const handleOpenProjectSettings = (projectId: string) => {
        setLeftPanel(null);
        setSettingsSection("general");
        setSettingsProjectId(projectId);
        dispatchLayoutPanelsApply({ feature: "plan", left: true, right: readFeaturePanelState("plan").right });
    };

    const navProps: PlanNavProps = {
        state: nav,
        onChange: setNav,
        onCreateEvent: handleCreateEvent,
        onCreateTask: handleCreateTask,
        onAddProject: handleAddProject,
        onDeleteProject: handleDeleteProject,
        onOpenProjectSettings: handleOpenProjectSettings,
        onAddCalendar: handleAddCalendar,
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
            onCreated={id => setSelectedTaskId(id)}
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
                        onClickEvent={id => cal.selectEvent(id)} onSelectTask={handleSelectTask} />
                )}
                {nav.view === "link" && <LinkView events={filteredEvents} sources={cal.sources} />}
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
                        projectLabelColorsByProjectId={projectLabelColorsByProjectId}
                        onSelectTask={handleSelectTask}
                        onMoveTask={(taskId, stateId, beforeTaskId) => void tsk.moveTask(taskId, null, stateId, beforeTaskId ?? null)}
                        onRequestCreateTask={stateId => handleCreateTask(stateId)} />
                )}
                {nav.view === "gantt" && (
                    <GanttView tasks={filteredTasks} selectedTaskId={selectedTaskId} projectNameById={projectNameById} onSelectTask={handleSelectTask} />
                )}
                    </>
                )}
            </div>
        </div>
    );

    return (
        <FeaturePanelsShell
            feature="plan"
            left={leftContent ?? undefined}
            center={center}
            right={undefined}
        />
    );
}
