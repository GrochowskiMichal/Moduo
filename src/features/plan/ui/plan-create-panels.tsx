import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, Circle, Clock3, Flag, FolderKanban, MapPin, Palette, Plus, Tags, UserRound } from "lucide-react";
import type { TaskPriority, TaskWorkflowState } from "../../tasks/types";
import { priorityVisual } from "../../tasks/ui/task-visuals";
import { normalizeHexColor } from "../../../utils/colors";
import {
    FieldLabel,
    LabelsSelector,
    PanelHeader,
    ProjectAvatar,
    compareStages,
    defaultStageVisual,
    fromLocalDateTimeInput,
    inputClassName,
    toLocalDateTimeInput,
} from "./plan-workspace-helpers";

// ─── new task left panel ───────────────────────────────────────────────────────
export function NewTaskPanel({ states, projects, defaultProjectId, defaultStateId, canEdit, forceProjectSelect = false, assigneeOptions, defaultAssigneeId, onSubmit, onCreated, onCancel }: {
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
export function NewEventPanel({
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

