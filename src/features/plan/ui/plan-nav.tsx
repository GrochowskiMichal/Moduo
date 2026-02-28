import { useEffect, useRef, useState } from "react";
import type { CalendarSource } from "../../calendar/types";
import type { TaskProject } from "../../tasks/types";

// ─── types ────────────────────────────────────────────────────────────────────
export type PlanSection = "all" | "events" | "tasks";
export type PlanView = "calendar" | "list" | "link" | "kanban" | "gantt";
export type CalDensity = "day" | "week" | "month";

export type PlanNavState = {
    section: PlanSection;
    view: PlanView;
    density: CalDensity;
    calendarId: string | null;
    projectId: string | null;
};

const SECTION_VIEWS: Record<PlanSection, PlanView[]> = {
    all: ["calendar", "list"],
    events: ["calendar", "list", "link"],
    tasks: ["calendar", "kanban", "list", "gantt"],
};

function getSectionViews(section: PlanSection, projectId: string | null): PlanView[] {
    if (section === "tasks" && !projectId) {
        return SECTION_VIEWS.tasks.filter(v => v !== "kanban");
    }
    return SECTION_VIEWS[section];
}

export function clampView(v: PlanView, s: PlanSection, projectId: string | null): PlanView {
    const allowed = getSectionViews(s, projectId);
    return allowed.includes(v) ? v : allowed[0]!;
}

// ─── tiny icons ───────────────────────────────────────────────────────────────
const Ico = {
    Plus: () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
    Cal: () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
    CalAdd: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="12" y1="14" x2="12" y2="20" /><line x1="9" y1="17" x2="15" y2="17" /></svg>,
    Filter: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="21" y1="4" x2="14" y2="4" /><line x1="10" y1="4" x2="3" y2="4" /><line x1="21" y1="12" x2="12" y2="12" /><line x1="8" y1="12" x2="3" y2="12" /><line x1="21" y1="20" x2="16" y2="20" /><line x1="12" y1="20" x2="3" y2="20" /><circle cx="12" cy="4" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="14" cy="20" r="2" /></svg>,
    List: () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>,
    Link: () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
    Kanban: () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="5" height="15" rx="1" /></svg>,
    Gantt: () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /><rect x="5" y="4" width="8" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.4" /><rect x="9" y="10" width="10" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.4" /><rect x="3" y="16" width="6" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.4" /></svg>,
    // fix 8: gear always visible (not hidden by opacity)
    Gear: () => <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
    Trash: () => <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>,
    ChevDown: () => <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>,
    ChevL: () => <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>,
    ChevR: () => <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 6 15 12 9 18" /></svg>,
};

const VIEW_ICO: Record<PlanView, React.ReactNode> = {
    calendar: <Ico.Cal />, list: <Ico.List />, link: <Ico.Link />, kanban: <Ico.Kanban />, gantt: <Ico.Gantt />,
};
const VIEW_LABEL: Record<PlanView, string> = {
    calendar: "Calendar", list: "List", link: "Let them slot", kanban: "Kanban", gantt: "Gantt",
};

// ─── inner pill separator ─────────────────────────────────────────────────────
function PillSep() {
    return <div className="self-stretch w-px bg-[#252525] my-1.5 shrink-0" />;
}
function NavSep() {
    return <div className="h-4 w-px bg-[#1e1e1e] shrink-0" />;
}

// ─── delete-confirm inline (fix 4: text split to two lines) ──────────────────
function DeleteConfirm({ name, label, onDelete, onCancel }: {
    name: string; label: string; onDelete: () => void; onCancel: () => void;
}) {
    const [typed, setTyped] = useState("");
    return (
        <div className="px-3 py-2.5 border-t border-[#1a1a1a] bg-[#0c0c0c]">
            {/* fix 4: "to delete this {label}" on its own line */}
            <p className="text-[9px] text-[#555] mb-1.5 leading-relaxed">
                Type <span className="text-[#bbb] font-semibold">{name}</span>
                <br />to delete this {label}.
            </p>
            <input
                autoFocus value={typed} onChange={e => setTyped(e.target.value)}
                placeholder={name}
                className="w-full bg-[#111] border border-[#1e1e1e] rounded-lg px-2 py-1 text-[10px] text-[#ddd] outline-none placeholder:text-[#2a2a2a] mb-2"
            />
            <div className="flex gap-1.5">
                <button
                    onClick={() => { if (typed.trim() === name) onDelete(); }}
                    disabled={typed.trim() !== name}
                    className="flex-1 py-1 rounded-lg text-[9px] font-bold transition-all disabled:opacity-25 bg-[#1a1010] border border-[#2a1818] text-red-400/70 hover:text-red-400 disabled:pointer-events-none"
                >Delete</button>
                <button onClick={onCancel} className="flex-1 py-1 rounded-lg text-[9px] text-[#333] border border-[#1a1a1a] hover:text-[#888] hover:bg-[#111]">
                    Cancel
                </button>
            </div>
        </div>
    );
}

// ─── smart dropdown (fix 2: no check icon; fix 3: no red bg on trash; fix 8: gear always visible) ──
type DropItem = { id: string; label: string; color?: string; iconUrl?: string; };

function SmartDropdown({ triggerLabel, items, selected, onSelect, onDeleteItem, onSettingsItem, onClickAdd, addLabel }: {
    triggerLabel: string;
    items: DropItem[];
    selected: string | null;
    onSelect: (id: string | null) => void;
    onDeleteItem?: (id: string) => Promise<void> | void;
    onSettingsItem?: (id: string) => void;
    onClickAdd?: () => void;
    addLabel: string;
}) {
    const [open, setOpen] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const cur = items.find(i => i.id === selected);

    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setDeletingId(null); }
        };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(p => !p)}
                className="flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-semibold text-[#bbb] hover:text-white transition-colors"
            >
                {cur?.color && <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cur.color }} />}
                {!cur?.color && cur?.iconUrl && (
                    <span className="w-5 h-5 rounded-[8px] border border-[#252525] bg-[#1a1a1a] p-[4px] shrink-0 overflow-hidden grid place-items-center">
                        <img src={cur.iconUrl} alt={cur.label} className="w-full h-full rounded-[6px] object-cover" />
                    </span>
                )}
                {/* Show selected label or fall through to "All X" label */}
                {cur?.label ?? triggerLabel}
                <span className="text-[#555]"><Ico.ChevDown /></span>
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[200px] rounded-xl border border-[#1e1e1e] bg-[#0d0d0d] py-1 animate-in fade-in zoom-in-95 duration-100 origin-top-left">

                    {/* "All X" — no icon, no check mark (fix 2) */}
                    <button
                        onClick={() => { onSelect(null); setOpen(false); setDeletingId(null); }}
                        className={`flex items-center w-full px-3 py-1.5 text-[11px] transition-colors text-left whitespace-nowrap ${selected === null ? "text-white bg-[#191919]" : "text-[#666] hover:text-[#ddd] hover:bg-[#111]"
                            }`}
                    >
                        {triggerLabel}
                    </button>

                    {items.length > 0 && <div className="my-1 h-px bg-[#141414]" />}

                    {items.map(item => (
                        <div key={item.id}>
                            <div className={`flex items-center w-full px-3 py-1.5 gap-2 group transition-colors ${item.id === selected ? "bg-[#181818]" : "hover:bg-[#111]"
                                }`}>
                                {item.color
                                    ? <div className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                                    : item.iconUrl
                                        ? (
                                            <span className="w-5 h-5 rounded-[8px] border border-[#252525] bg-[#1a1a1a] p-[4px] shrink-0 overflow-hidden grid place-items-center">
                                                <img src={item.iconUrl} alt={item.label} className="w-full h-full rounded-[6px] object-cover" />
                                            </span>
                                        )
                                        : null
                                }
                                {/* label clickable, no check mark (fix 2) */}
                                <button
                                    onClick={() => { onSelect(item.id); setOpen(false); setDeletingId(null); }}
                                    className={`flex-1 text-[11px] text-left truncate ${item.id === selected ? "text-[#ddd]" : "text-[#666] group-hover:text-[#ddd]"}`}
                                >
                                    {item.label}
                                </button>

                                {/* fix 8: gear + trash always visible on hover, gear is placeholder */}
                                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {/* gear — placeholder, no op */}
                                    <button
                                        onClick={e => { e.stopPropagation(); if (onSettingsItem) { onSettingsItem(item.id); setOpen(false); } }}
                                        title="Project settings"
                                        className="h-5 w-5 grid place-items-center rounded text-[#333] hover:text-[#777] transition-colors"
                                    ><Ico.Gear /></button>

                                    {/* fix 3: trash — no red bg, just icon color change */}
                                    {onDeleteItem && (
                                        <button
                                            onClick={e => { e.stopPropagation(); setDeletingId(prev => prev === item.id ? null : item.id); }}
                                            title="Delete"
                                            className="h-5 w-5 grid place-items-center rounded text-[#333] hover:text-red-400 transition-colors"
                                        ><Ico.Trash /></button>
                                    )}
                                </div>
                            </div>

                            {/* inline delete confirm */}
                            {deletingId === item.id && onDeleteItem && (
                                <DeleteConfirm
                                    name={item.label}
                                    label={addLabel.toLowerCase().replace("new ", "")}
                                    onDelete={async () => {
                                        await onDeleteItem(item.id);
                                        setDeletingId(null);
                                        if (selected === item.id) onSelect(null);
                                    }}
                                    onCancel={() => setDeletingId(null)}
                                />
                            )}
                        </div>
                    ))}

                    {/* + add button */}
                    {onClickAdd && (
                        <>
                            <div className="my-1 h-px bg-[#141414]" />
                            <button
                                onClick={() => { onClickAdd(); setOpen(false); }}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-[#555] hover:text-[#aaa] hover:bg-[#111] transition-colors"
                            >
                                <Ico.Plus />{addLabel}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── active pill wrapper ──────────────────────────────────────────────────────
function ActivePill({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center h-8 bg-[#1b1b1b] border border-[#282828] rounded-xl">
            {children}
        </div>
    );
}

// ─── SECTION GROUP ────────────────────────────────────────────────────────────
type SectionProps = {
    current: PlanSection;
    onChange: (s: PlanSection) => void;
    calItems: DropItem[];
    projItems: DropItem[];
    calendarId: string | null;
    projectId: string | null;
    onCalendarChange: (id: string | null) => void;
    onProjectChange: (id: string | null) => void;
    onDeleteProject: (id: string) => Promise<void>;
    onOpenProjectSettings: (id: string) => void;
    onAddProject: () => void;
    onAddCalendar: () => void;
};

function SectionGroup({ current, onChange, calItems, projItems, calendarId, projectId,
    onCalendarChange, onProjectChange, onDeleteProject, onOpenProjectSettings, onAddProject, onAddCalendar }: SectionProps) {
    const sections: { id: PlanSection; label: string }[] = [
        { id: "all", label: "All" },
        { id: "events", label: "Events" },
        { id: "tasks", label: "Tasks" },
    ];

    return (
        <div className="flex items-center gap-1.5">
            {sections.map(s => {
                const active = s.id === current;
                if (!active) {
                    return (
                        <button key={s.id} onClick={() => onChange(s.id)}
                            className="h-8 px-3 text-[11px] font-semibold text-[#333] hover:text-[#888] transition-colors">
                            {s.label}
                        </button>
                    );
                }
                return (
                    <ActivePill key={s.id}>
                        <span className="px-3 text-[11px] font-bold text-white whitespace-nowrap">{s.label}</span>
                        {(s.id === "all" || s.id === "events") && (
                            <>
                                <PillSep />
                                <SmartDropdown
                                    triggerLabel="All Calendars"
                                    items={calItems}
                                    selected={calendarId}
                                    onSelect={onCalendarChange}
                                    onClickAdd={onAddCalendar}
                                    addLabel="New Calendar"
                                />
                            </>
                        )}
                        {(s.id === "all" || s.id === "tasks") && (
                            <>
                                <PillSep />
                                <SmartDropdown
                                    triggerLabel="All Projects"
                                    items={projItems}
                                    selected={projectId}
                                    onSelect={onProjectChange}
                                    onDeleteItem={onDeleteProject}
                                    onSettingsItem={onOpenProjectSettings}
                                    onClickAdd={onAddProject}
                                    addLabel="New Project"
                                />
                            </>
                        )}
                    </ActivePill>
                );
            })}
        </div>
    );
}

// ─── VIEW GROUP (fix 7: onNavigate wired to < >) ────────────────────────────
function ViewGroup({ section, current, density, projectId, onChange, onDensity, onNavigate }: {
    section: PlanSection; current: PlanView; density: CalDensity;
    projectId: string | null;
    onChange: (v: PlanView) => void; onDensity: (d: CalDensity) => void;
    onNavigate: (dir: -1 | 1) => void;
}) {
    const views = getSectionViews(section, projectId);
    return (
        <div className="flex items-center gap-1">
            {views.map(v => {
                const active = v === current;
                if (!active) {
                    return (
                        <button key={v} onClick={() => onChange(v)}
                            className="flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold text-[#333] hover:text-[#888] transition-colors">
                            <span className="text-[#2a2a2a]">{VIEW_ICO[v]}</span>
                            {VIEW_LABEL[v]}
                        </button>
                    );
                }
                if (v === "calendar") {
                    return (
                        <ActivePill key={v}>
                            <div className="flex items-center gap-1.5 px-3">
                                <span className="text-[#666]"><Ico.Cal /></span>
                                <span className="text-[11px] font-bold text-white">Calendar</span>
                            </div>
                            <PillSep />
                            {/* fix 7: < > are wired via onNavigate */}
                            <div className="flex items-center px-1.5 gap-0.5">
                                <button onClick={() => onNavigate(-1)}
                                    className="h-5 w-5 grid place-items-center text-[#444] hover:text-[#ccc] transition-colors rounded">
                                    <Ico.ChevL />
                                </button>
                                {(["day", "week", "month"] as CalDensity[]).map(d => (
                                    <button key={d} onClick={() => onDensity(d)}
                                        className={`h-6 px-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${density === d ? "bg-[#2a2a2a] text-[#eee]" : "text-[#333] hover:text-[#888]"
                                            }`}>
                                        {d[0]!.toUpperCase()}
                                    </button>
                                ))}
                                <button onClick={() => onNavigate(1)}
                                    className="h-5 w-5 grid place-items-center text-[#444] hover:text-[#ccc] transition-colors rounded">
                                    <Ico.ChevR />
                                </button>
                            </div>
                        </ActivePill>
                    );
                }
                return (
                    <ActivePill key={v}>
                        <div className="flex items-center gap-1.5 px-3">
                            <span className="text-[#666]">{VIEW_ICO[v]}</span>
                            <span className="text-[11px] font-bold text-white">{VIEW_LABEL[v]}</span>
                        </div>
                    </ActivePill>
                );
            })}
        </div>
    );
}

// ─── context / create button ──────────────────────────────────────────────────
function ContextButton({ section, onCreateEvent, onCreateTask }: {
    section: PlanSection; onCreateEvent: () => void; onCreateTask: () => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, [open]);

    const Icon = Ico.Plus;
    return (
        <div ref={ref} className="relative shrink-0">
            <button
                onClick={() => setOpen(p => !p)}
                className="h-8 w-8 grid place-items-center rounded-xl border border-[#1e1e1e] text-[#444] hover:text-[#aaa] hover:bg-[#161616] hover:border-[#2a2a2a] transition-all"
            ><Icon /></button>
            {open && (
                <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[150px] rounded-xl border border-[#1e1e1e] bg-[#0d0d0d] py-1 animate-in fade-in zoom-in-95 duration-100">
                    {(section === "all" || section === "events") && (
                        <button onClick={() => { onCreateEvent(); setOpen(false); }}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-[#666] hover:text-[#ddd] hover:bg-[#111] transition-colors">
                            <Ico.Cal />New event
                        </button>
                    )}
                    {(section === "all" || section === "tasks") && (
                        <button onClick={() => { onCreateTask(); setOpen(false); }}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] text-[#666] hover:text-[#ddd] hover:bg-[#111] transition-colors">
                            <Ico.List />New task
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── main PlanNav ─────────────────────────────────────────────────────────────
export type PlanNavProps = {
    state: PlanNavState;
    onChange: (s: PlanNavState) => void;
    onCreateEvent: () => void;
    onCreateTask: () => void;
    onAddProject: () => void;
    onDeleteProject: (id: string) => Promise<void>;
    onOpenProjectSettings: (id: string) => void;
    onAddCalendar: () => void;
    onNavigate: (dir: -1 | 1) => void;   // fix 7
    sources: CalendarSource[];
    projects: TaskProject[];
};

export function PlanNav({ state, onChange, onCreateEvent, onCreateTask, onAddProject, onDeleteProject, onOpenProjectSettings, onAddCalendar, onNavigate, sources, projects }: PlanNavProps) {
    const { section, view, density, calendarId, projectId } = state;
    const set = (patch: Partial<PlanNavState>) => onChange({ ...state, ...patch });

    const calItems: DropItem[] = sources.map(s => ({ id: s.id, label: s.name, color: s.color }));
    const projItems: DropItem[] = projects.filter(p => !p.deletedAt).map(p => ({ id: p.id, label: p.name, iconUrl: p.logoUrl ?? undefined }));

    return (
        <header className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[#0f0f0f]">
            <ContextButton section={section} onCreateEvent={onCreateEvent} onCreateTask={onCreateTask} />
            <SectionGroup
                current={section}
                onChange={s => set({ section: s, view: clampView(view, s, projectId) })}
                calItems={calItems} projItems={projItems}
                calendarId={calendarId} projectId={projectId}
                onCalendarChange={id => set({ calendarId: id })}
                onProjectChange={id => set({ projectId: id, view: clampView(view, section, id) })}
                onDeleteProject={onDeleteProject}
                onOpenProjectSettings={onOpenProjectSettings}
                onAddProject={onAddProject}
                onAddCalendar={onAddCalendar}
            />
            <NavSep />
            <ViewGroup
                section={section} current={view} density={density}
                projectId={projectId}
                onChange={v => set({ view: v })}
                onDensity={d => set({ density: d })}
                onNavigate={onNavigate}
            />
        </header>
    );
}
