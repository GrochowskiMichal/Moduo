import { useEffect, useState } from "react";
import type { Task } from "../../../tasks/types";
import { priorityVisual, formatTaskDate } from "../../../tasks/ui/task-visuals";

// Since we cannot easily pass down the runtime through Lexical cleanly,
// we just dynamically import the runtime inside the embedded component when it mounts
export function EmbeddedTask({ taskId }: { taskId: string }) {
    const [task, setTask] = useState<Task | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        const loadTask = async () => {
            try {
                const { runtime } = await import("../../../../lib/runtime");
                if (!runtime) return;

                // Iterate locally over all workspaces to find the task, since we don't know the exact workspace upfront.
                // Wait, realistically we might just know it from the note workspace? Let's assume the task is in the same DB.
                // For simplicity, we can fetch all workspaces, then query. But wait, `runtime.tasks.list()` requires a workspace ID.
                // A better approach is to provide the `workspaceId` via some Lexical context.
                // Or we can just read the active user db tasks? Actually, all tasks are stored in exactly the same DB (Redb backend). 
                // We can just invoke the rust command to get a single task if we had an endpoint. Or we can just read all tasks from all workspaces using `list` loop.

                // Actually Moduo uses Redb in desktop for tasks.
                // Let's check how tasks are fetched.
                const wId = "*"; // This might not work. Let's list workspaces first.
                const wss = await runtime.workspace.list();
                for (const w of wss) {
                    try {
                        const raw = await runtime.tasks.list(w.id);
                        const allTasks: Task[] = Array.isArray(raw?.tasks) ? raw.tasks : Array.isArray(raw) ? raw : [];
                        const found = allTasks.find(t => t.id === taskId);
                        if (found) {
                            if (active) setTask(found);
                            break;
                        }
                    } catch (e) { }
                }
            } catch (err) {
                console.error("Failed to load embedded task", err);
            } finally {
                if (active) setLoading(false);
            }
        };
        void loadTask();
        return () => {
            active = false;
        };
    }, [taskId]);

    if (loading) {
        return (
            <div className="w-full max-w-[500px] h-[80px] bg-[#1a1a1a]/50 border border-[#2a2a2a] rounded-xl flex items-center justify-center animate-pulse">
                <span className="text-[12px] text-[#555]">Loading embedded task...</span>
            </div>
        );
    }

    if (!task) {
        return (
            <div className="w-full max-w-[500px] bg-[#1a1a1a]/50 border border-[#2a2a2a] rounded-xl p-4 text-[#888] text-[13px]">
                Embedded Task <span className="font-mono text-[10px] text-[#555]">{taskId}</span> could not be found or was deleted.
            </div>
        );
    }

    const priority = priorityVisual(task.priority);
    const dueDate = formatTaskDate(task.dueDate);
    const tags = Array.isArray(task.tags) ? task.tags : [];
    const initial = task.assigneeId ? task.assigneeId.trim().charAt(0).toUpperCase() : null;

    return (
        <div className="w-full max-w-[500px] block cursor-pointer select-none group rounded-2xl border px-3.5 py-3 text-left transition-all duration-300 relative overflow-hidden backdrop-blur-md shadow-sm border-[#2a2a2a] bg-[#141414]/80 hover:bg-[#1a1a1a]/90 hover:border-[#3a3a3a] hover:shadow-lg hover:-translate-y-0.5">
            <div className="relative z-10 flex flex-col pointer-events-none">
                <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[14px] leading-none drop-shadow-md" style={{ color: priority.color }}>
                        {priority.icon}
                    </span>
                    <div className="min-w-0 flex-1 truncate text-[14px] font-medium leading-tight text-[#f0f2f5]">
                        {task.title || "Untitled"}
                    </div>
                </div>
                {task.description ? (
                    <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-[#8f96a3] font-light">
                        {task.description}
                    </p>
                ) : null}

                {tags.length ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="rounded-md bg-[#222] border border-[#333] px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase text-[#a0a8b8]">
                                {tag}
                            </span>
                        ))}
                    </div>
                ) : null}

                <div className="mt-3 flex items-center justify-between border-t border-[#2a2a2a]/50 pt-3">
                    <span className="text-[11px] font-medium text-[#7f8796] flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        {dueDate ? dueDate : "No due date"}
                    </span>
                    {initial ? (
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] shadow-inner border border-[#3a3a3a] text-[10px] font-bold text-[#e0e0e0]">
                            {initial}
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
