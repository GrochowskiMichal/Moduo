import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, Check, ChevronDown, Circle, Clock3, Flag, FolderKanban, MapPin, Palette, Plus, Tags, UserRound, X } from "lucide-react";
import { useCalendar } from "../../calendar/hooks/use-calendar";
import { useTasks } from "../../tasks/hooks/use-tasks";
import type { CalendarEvent } from "../../calendar/types";
import type { Task, TaskPriority, TaskRelationKind, TaskWorkflowState } from "../../tasks/types";
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
import { priorityVisual } from "../../tasks/ui/task-visuals";
import { normalizeHexColor } from "../../../utils/colors";

// ─── constants / helpers ──────────────────────────────────────────────────────
const AVATAR_STORAGE_KEY = "moduo:auth-avatar-preview-v1";
const AVATAR_STORE_NAMESPACE = "auth_ui";
const AVATAR_STORE_KEY = "avatar_preview_v1";
const PLAN_VIEW_STORAGE_KEY = "moduo:plan:view-v1";
const RELATION_LABELS: Record<TaskRelationKind, string> = {
    parent_of: "Parent of",
    child_of: "Child of",
    blocked_by: "Waiting on",
    blocking: "Holds",
    duplicate_of: "Mirror of",
};

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

function toLocalDateTimeInput(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDateTimeInput(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function PanelHeader({ title, eyebrow, onCancel }: { title: string; eyebrow: string; onCancel: () => void }) {
    return (
        <div className="flex items-start justify-between gap-3 border-b border-[#242424] pb-4">
            <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#6f6f6f]">{eyebrow}</div>
                <h2 className="mt-1 text-[20px] font-bold leading-tight text-[#f2f2f2]">{title}</h2>
            </div>
            <button
                type="button"
                onClick={onCancel}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-transparent text-[#777] transition-colors hover:border-[#2a2a2a] hover:bg-[#181818] hover:text-[#f0f0f0]"
                aria-label={`Close ${title}`}
            >
                <X size={16} strokeWidth={2.4} />
            </button>
        </div>
    );
}

function FieldLabel({ icon: Icon, children }: { icon?: typeof CalendarDays; children: string }) {
    return (
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">
            {Icon ? <Icon size={12} strokeWidth={2.2} /> : null}
            <span>{children}</span>
        </div>
    );
}

const inputClassName = "w-full rounded-xl border border-[#242424] bg-[#101010] px-3 py-2.5 text-[13px] text-[#eeeeee] outline-none transition-colors placeholder:text-[#555] hover:border-[#303030] focus:border-[#4a4a4a] focus:bg-[#121212]";

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
        return <div className="rounded-xl border border-dashed border-[#252525] bg-[#101010] px-3 py-2 text-[12px] text-[#666]">No labels in this project.</div>;
    }
    const selectedSet = new Set(selected);
    return (
        <div className="flex flex-wrap gap-2">
            {labels.map(label => {
                const active = selectedSet.has(label.name);
                return (
                    <button
                        key={label.name}
                        type="button"
                        onClick={() => onToggle(label.name)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${active ? "text-[#f1f1f1]" : "text-[#9c9c9c] hover:text-[#e5e5e5]"}`}
                        style={{ borderColor: `${label.color}${active ? "" : "66"}`, background: active ? `${label.color}24` : "#101010" }}
                    >
                        <span className="h-2 w-2 rounded-full" style={{ background: label.color }} />
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

    const projStates = useMemo(() => {
        const next = states.filter(s => !s.deletedAt && s.projectId === projectId);
        return [...next].sort(compareStages);
    }, [projectId, states]);
    const projectLabels = projects.find(p => p.id === projectId)?.labels ?? [];
    const [stateId, setStateId] = useState<string>(() => {
        if (defaultStateId && projStates.some(s => s.id === defaultStateId)) return defaultStateId;
        return projStates[0]?.id ?? "";
    });

    useEffect(() => {
        const defaultIsValid = !!defaultStateId && projStates.some(s => s.id === defaultStateId);
        const nextStateId = defaultIsValid ? defaultStateId! : (projStates[0]?.id ?? "");
        setStateId((prev) => {
            if (defaultIsValid) return prev === nextStateId ? prev : nextStateId;
            const prevValid = !!prev && projStates.some(s => s.id === prev);
            if (prevValid) return prev;
            return prev === nextStateId ? prev : nextStateId;
        });
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
        <div className="flex h-full min-h-0 flex-col">
            <PanelHeader title="New Task" eyebrow="Tasks" onCancel={onCancel} />

            <div className="flex-1 space-y-5 overflow-y-auto pt-5 pr-1">
                <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
                    placeholder="Task title…"
                    className="w-full border-b border-[#2a2a2a] bg-transparent pb-3 text-[22px] font-bold leading-tight text-[#f3f3f3] outline-none transition-colors placeholder:text-[#4a4a4a] focus:border-[#5a5a5a]" />

                <div>
                    <FieldLabel>Description</FieldLabel>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
                        className={`${inputClassName} min-h-24 resize-none`}
                        placeholder="Task description…" />
                </div>

                <div>
                    <FieldLabel icon={Tags}>Labels</FieldLabel>
                    <LabelsSelector
                        labels={projectLabels}
                        selected={tags}
                        onToggle={(name) => setTags(prev => prev.includes(name) ? prev.filter(tag => tag !== name) : [...prev, name])}
                    />
                </div>

                {(forceProjectSelect || projects.length > 1) && (
                    <div>
                        <FieldLabel icon={FolderKanban}>Project</FieldLabel>
                        <div ref={projectRef} className="relative">
                            <button type="button" onClick={() => setProjectOpen(v => !v)} className={`${inputClassName} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <ProjectAvatar
                                        name={(projects.find(p => p.id === projectId)?.name ?? "Project")}
                                        logoUrl={projects.find(p => p.id === projectId)?.logoUrl ?? null}
                                    />
                                    <span>{projects.find(p => p.id === projectId)?.name ?? "Project"}</span>
                                </div>
                                <ChevronDown size={16} className="text-[#777]" />
                            </button>
                            {projectOpen && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-44 overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#101010] p-1 shadow-2xl">
                                    {projects.filter(p => !p.deletedAt).map(p => (
                                        <button key={p.id} type="button" onClick={() => { setProjectId(p.id); setProjectOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#cfcfcf] hover:bg-[#191919]">
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
                    <div>
                        <FieldLabel icon={Circle}>Stage</FieldLabel>
                        <div ref={stageRef} className="relative">
                            <button type="button" onClick={() => setStageOpen(v => !v)} className={`${inputClassName} flex items-center justify-between`}>
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
                                <ChevronDown size={16} className="text-[#777]" />
                            </button>
                            {stageOpen && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-44 overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#101010] p-1 shadow-2xl">
                                    {projStates.map(s => {
                                        const fallback = defaultStageVisual(s.kind);
                                        return (
                                            <button key={s.id} type="button" onClick={() => { setStateId(s.id); setStageOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#cfcfcf] hover:bg-[#191919]">
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

                <div>
                    <FieldLabel icon={Flag}>Priority</FieldLabel>
                    <select value={priority} onChange={e => setPriority(Number(e.target.value) as TaskPriority)}
                        className={`${inputClassName} [color-scheme:dark]`}
                        style={{ color: priorityVisual(priority).color }}>
                        {[["PI", 0], ["PII", 1], ["PIII", 2], ["PIV", 3], ["Nulla", 4]].map(([l, v]) => (
                            <option key={v} value={Number(v)} className="bg-[#0e0e0e]" style={{ color: priorityVisual(Number(v) as TaskPriority).color }}>
                                {l}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <FieldLabel icon={CalendarDays}>Deadline</FieldLabel>
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                        className={`${inputClassName} [color-scheme:dark]`} />
                </div>

                <div>
                    <FieldLabel icon={UserRound}>Assignee</FieldLabel>
                    <div ref={assigneeRef} className="relative">
                        <button type="button" onClick={() => setAssigneeOpen(o => !o)} className={`${inputClassName} flex items-center justify-between`}>
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
                            <ChevronDown size={16} className="text-[#777]" />
                        </button>
                        {assigneeOpen && (
                            <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-44 overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#101010] p-1 shadow-2xl">
                                <button type="button" onClick={() => { setAssigneeId(""); setAssigneeOpen(false); }} className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-[#888] hover:bg-[#191919]">Unassigned</button>
                                {assigneeOptions.map(opt => (
                                    <button key={opt.id} type="button" onClick={() => { setAssigneeId(opt.id); setAssigneeOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-[#cfcfcf] hover:bg-[#191919]">
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

            <div className="mt-4 border-t border-[#242424] pt-4">
                <button onClick={() => void submit()} disabled={!title.trim() || submitting || !canEdit}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f2f2f2] py-3 text-[13px] font-bold text-[#101010] transition-colors hover:bg-white disabled:bg-[#1b1b1b] disabled:text-[#555] disabled:pointer-events-none">
                    {submitting ? null : <Plus size={16} strokeWidth={2.6} />}
                    {submitting ? "Creating…" : "Create Task"}
                </button>
                <button
                    type="button"
                    onClick={() => setCreateMore(v => !v)}
                    className="mt-3 flex w-full items-center justify-between rounded-xl border border-[#242424] bg-[#101010] px-3 py-2.5 text-[13px] text-[#b5b5b5] transition-colors hover:border-[#303030] hover:text-[#eeeeee]"
                >
                    <span>Create more</span>
                    <span className={`relative inline-flex h-6 w-11 rounded-full border transition-colors ${createMore ? "border-[#f2f2f2] bg-[#f2f2f2]" : "border-[#333] bg-[#1b1b1b]"}`}>
                        <span className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full transition-transform ${createMore ? "translate-x-5 bg-[#101010] text-[#f2f2f2]" : "translate-x-0.5 bg-[#d8d8d8] text-[#101010]"}`}>
                            {createMore ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                    </span>
                </button>
            </div>
        </div>
    );
}

// ─── new event left panel ─────────────────────────────────────────────────────
function NewEventPanel({
    sources,
    defaultCalendarId,
    onCancel,
    onSubmit,
}: {
    sources: Array<{ id: string; name: string; color: string; visible: boolean }>;
    defaultCalendarId: string | null;
    onCancel: () => void;
    onSubmit: (args: {
        title: string;
        calendarId: string;
        startTime: string;
        endTime: string;
        allDay: boolean;
        location: string;
        description: string;
        color: string;
    }) => void;
}) {
    const firstVisible = sources.find(s => s.visible) ?? sources[0] ?? null;
    const now = new Date(); now.setMinutes(0, 0, 0);
    const defaultEnd = new Date(now); defaultEnd.setHours(defaultEnd.getHours() + 1);

    const [calendarId, setCalendarId] = useState<string>(defaultCalendarId ?? firstVisible?.id ?? "");
    const [title, setTitle] = useState("New Event");
    const [allDay, setAllDay] = useState(false);
    const [startTime, setStartTime] = useState(toLocalDateTimeInput(now));
    const [endTime, setEndTime] = useState(toLocalDateTimeInput(defaultEnd));
    const [location, setLocation] = useState("");
    const [description, setDescription] = useState("");

    const selectedSource = sources.find(s => s.id === calendarId) ?? firstVisible;
    const sourceColor = normalizeHexColor(selectedSource?.color ?? "") ?? "#3A3A3A";
    const [color, setColor] = useState<string>(sourceColor);
    const [colorDraft, setColorDraft] = useState<string>(sourceColor);
    const [colorTouched, setColorTouched] = useState(false);

    useEffect(() => {
        if (colorTouched) return;
        setColor(sourceColor);
        setColorDraft(sourceColor);
    }, [sourceColor, colorTouched]);

    const startsAt = new Date(startTime);
    const endsAt = new Date(endTime);
    const hasInvalidRange = Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt;

    const submit = () => {
        if (!calendarId || !title.trim() || hasInvalidRange) return;
        onSubmit({
            title: title.trim(),
            calendarId,
            startTime: fromLocalDateTimeInput(startTime),
            endTime: fromLocalDateTimeInput(endTime),
            allDay,
            location: location.trim(),
            description: description.trim(),
            color,
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <PanelHeader title="New Event" eyebrow="Calendar" onCancel={onCancel} />
            <div className="flex-1 space-y-5 overflow-y-auto pt-5 pr-1">
                <div>
                    <FieldLabel>Title</FieldLabel>
                    <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }} className={inputClassName} />
                </div>
                <div>
                    <FieldLabel icon={CalendarDays}>Calendar</FieldLabel>
                    <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className={`${inputClassName} [color-scheme:dark]`}>
                        {sources.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>
                <button
                    type="button"
                    onClick={() => setAllDay(v => !v)}
                    className="flex w-full items-center justify-between rounded-xl border border-[#242424] bg-[#101010] px-3 py-2.5 text-[13px] text-[#b5b5b5] transition-colors hover:border-[#303030] hover:text-[#eeeeee]"
                >
                    <span>All day</span>
                    <span className={`relative inline-flex h-6 w-11 rounded-full border transition-colors ${allDay ? "border-[#f2f2f2] bg-[#f2f2f2]" : "border-[#333] bg-[#1b1b1b]"}`}>
                        <span className={`absolute top-0.5 grid h-5 w-5 place-items-center rounded-full transition-transform ${allDay ? "translate-x-5 bg-[#101010] text-[#f2f2f2]" : "translate-x-0.5 bg-[#d8d8d8] text-[#101010]"}`}>
                            {allDay ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                    </span>
                </button>
                <div>
                    <FieldLabel icon={Palette}>Color</FieldLabel>
                    <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2">
                        <label className="grid h-11 w-11 place-items-center rounded-xl border border-[#242424] bg-[#101010] transition-colors hover:border-[#303030]" title="Event color">
                            <span className="h-6 w-6 rounded-md border border-[#3a3a3a]" style={{ background: color }} />
                            <input
                                type="color"
                                value={color}
                                onChange={(e) => {
                                    const next = normalizeHexColor(e.target.value);
                                    if (!next) return;
                                    setColorTouched(true);
                                    setColor(next);
                                    setColorDraft(next);
                                }}
                                className="sr-only"
                                aria-label="Event color picker"
                            />
                        </label>
                        <input
                            value={colorDraft}
                            onChange={(e) => {
                                const nextDraft = e.target.value;
                                setColorTouched(true);
                                setColorDraft(nextDraft);
                                const next = normalizeHexColor(nextDraft);
                                if (next) setColor(next);
                            }}
                            onBlur={() => {
                                const next = normalizeHexColor(colorDraft);
                                if (next) {
                                    setColor(next);
                                    setColorDraft(next);
                                    return;
                                }
                                setColorDraft(color);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") (e.currentTarget as HTMLInputElement).blur();
                            }}
                            className={`${inputClassName} font-mono`}
                            placeholder="#RRGGBB"
                            maxLength={7}
                            aria-label="Event color hex"
                        />
                        <button
                            type="button"
                            onClick={() => {
                                setColorTouched(false);
                                setColor(sourceColor);
                                setColorDraft(sourceColor);
                            }}
                            className="h-11 shrink-0 rounded-xl border border-[#242424] bg-[#101010] px-3 text-[12px] font-semibold text-[#a8a8a8] transition-colors hover:border-[#303030] hover:bg-[#151515] hover:text-[#f0f0f0]"
                            title="Reset to calendar color"
                        >
                            Reset
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                        <FieldLabel icon={Clock3}>Start</FieldLabel>
                        <input
                            type="datetime-local"
                            value={startTime}
                            onChange={(e) => {
                                const nextStart = e.target.value;
                                setStartTime(nextStart);
                                const nextStartDate = new Date(nextStart);
                                if (!Number.isNaN(nextStartDate.getTime()) && new Date(endTime) <= nextStartDate) {
                                    const nextEnd = new Date(nextStartDate);
                                    nextEnd.setHours(nextEnd.getHours() + 1);
                                    setEndTime(toLocalDateTimeInput(nextEnd));
                                }
                            }}
                            className={`${inputClassName} min-w-0 [color-scheme:dark]`}
                        />
                    </div>
                    <div className="min-w-0">
                        <FieldLabel icon={Clock3}>End</FieldLabel>
                        <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={`${inputClassName} min-w-0 [color-scheme:dark]`} />
                    </div>
                </div>
                {hasInvalidRange && (
                    <div className="rounded-xl border border-[#4a2a2a] bg-[#1a1010] px-3 py-2 text-[12px] text-[#d99797]">
                        End time must be after start time.
                    </div>
                )}
                <div>
                    <FieldLabel icon={MapPin}>Location</FieldLabel>
                    <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add a location" className={inputClassName} />
                </div>
                <div>
                    <FieldLabel>Description</FieldLabel>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Add notes or agenda…" className={`${inputClassName} min-h-32 resize-none`} />
                </div>
            </div>
            <div className="mt-4 border-t border-[#242424] pt-4">
                    <button
                        onClick={submit}
                        disabled={!calendarId || !title.trim() || hasInvalidRange}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#f2f2f2] py-3 text-[13px] font-bold text-[#101010] transition-colors hover:bg-white disabled:bg-[#1b1b1b] disabled:text-[#555] disabled:pointer-events-none"
                    >
                        <Plus size={16} strokeWidth={2.6} />
                        Create Event
                    </button>
            </div>
        </div>
    );
}

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
