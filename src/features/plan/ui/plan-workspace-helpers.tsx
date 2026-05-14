import { X, type LucideIcon } from "lucide-react";
import type { TaskRelationKind, TaskWorkflowState } from "../../tasks/types";
import { clampView, type PlanNavState } from "./plan-nav";

export const AVATAR_STORAGE_KEY = "moduo:auth-avatar-preview-v1";
export const AVATAR_STORE_NAMESPACE = "auth_ui";
export const AVATAR_STORE_KEY = "avatar_preview_v1";
export const PLAN_VIEW_STORAGE_KEY = "moduo:plan:view-v1";

export const RELATION_LABELS: Record<TaskRelationKind, string> = {
    parent_of: "Parent of",
    child_of: "Child of",
    blocked_by: "Waiting on",
    blocking: "Holds",
    duplicate_of: "Mirror of",
};

export const inputClassName = "w-full rounded-xl border border-[#242424] bg-[#101010] px-3 py-2.5 text-[13px] text-[#eeeeee] outline-none transition-colors placeholder:text-[#555] hover:border-[#303030] focus:border-[#4a4a4a] focus:bg-[#121212]";

const STAGE_KIND_RANK: Record<string, number> = {
    backlog: 0,
    todo: 1,
    in_progress: 2,
    in_review: 3,
    done: 4,
    canceled: 5,
    custom: 6,
};

export function defaultStageVisual(kind: string): { icon: string; color: string } {
    if (kind === "todo") return { icon: "◯", color: "#C9CED6" };
    if (kind === "in_progress") return { icon: "◔", color: "#F5A524" };
    if (kind === "done") return { icon: "◉", color: "#2DD4BF" };
    if (kind === "in_review") return { icon: "◑", color: "#60A5FA" };
    if (kind === "backlog") return { icon: "◇", color: "#9CA3AF" };
    if (kind === "canceled") return { icon: "⨯", color: "#EF4444" };
    return { icon: "◯", color: "#8E8E8E" };
}

function stagePositionOrder(position: string): number {
    const m = position.match(/(\d+)\s*$/);
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

export function compareStages(a: TaskWorkflowState, b: TaskWorkflowState): number {
    const po = stagePositionOrder(a.position) - stagePositionOrder(b.position);
    if (po !== 0) return po;
    const ko = (STAGE_KIND_RANK[a.kind] ?? 99) - (STAGE_KIND_RANK[b.kind] ?? 99);
    if (ko !== 0) return ko;
    return a.name.localeCompare(b.name);
}

export function toLocalDateTimeInput(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalDateTimeInput(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function readSavedPlanView(): { nav: PlanNavState; focusDate: Date } | null {
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

export function PanelHeader({ title, eyebrow, onCancel }: { title: string; eyebrow: string; onCancel: () => void }) {
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

export function FieldLabel({ icon: Icon, children }: { icon?: LucideIcon; children: string }) {
    return (
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#777]">
            {Icon ? <Icon size={12} strokeWidth={2.2} /> : null}
            <span>{children}</span>
        </div>
    );
}

export function ProjectAvatar({ name, logoUrl, size = 14 }: { name: string; logoUrl?: string | null; size?: number }) {
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

export function LabelsSelector({
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
