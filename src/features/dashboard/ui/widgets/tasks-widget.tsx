import React, { useMemo } from "react";
import { useTasks } from "../../../tasks/hooks/use-tasks";
import { WidgetConfig } from "../../types";
import { useWorkspace } from "../../../../providers/workspace-provider";
import { useAuth } from "../../../../providers/auth-provider";

interface TasksWidgetProps {
  config: WidgetConfig;
  onUpdateConfig: (config: Partial<WidgetConfig>) => void;
  isLocked: boolean;
}

export function TasksWidget({ config, onUpdateConfig, isLocked }: TasksWidgetProps) {
  const { selectedWorkspace, modulePermissions } = useWorkspace();
  const { userId, supabase } = useAuth();
  
  const { tasks, projects, states, loading, updateTask } = useTasks(supabase, {
    userId,
    workspaceId: selectedWorkspace?.id ?? null,
    modulePermission: modulePermissions.tasks,
  });

  const filteredTasks = useMemo(() => {
    let result = tasks.filter((t) => !t.deletedAt);

    // Filter by project
    if (config.projectIds && config.projectIds.length > 0) {
      result = result.filter((t) => config.projectIds?.includes(t.projectId));
    }

    // Filter by tags
    if (config.tags && config.tags.length > 0) {
      result = result.filter((t) => 
        t.tags?.some((tag) => config.tags?.includes(tag))
      );
    }
    
    // Sort by priority/date/etc? Default to position or created
    return result.sort((a, b) => (a.priority - b.priority) || a.position.localeCompare(b.position));
  }, [tasks, config.projectIds, config.tags]);

  const projectOptions = useMemo(() => 
    projects.filter(p => !p.deletedAt), 
    [projects]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse w-4 h-4 rounded-full bg-[#333]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#111111]">
      {/* Header / Filter Controls */}
      <div className="px-4 py-3 border-b border-[#1e1e1e] bg-[#151515]/50 flex flex-col gap-2">
        <div className="flex items-center justify-between">
           <span className="text-[#e5ecff] font-semibold text-xs uppercase tracking-wider">
             Tasks ({filteredTasks.length})
           </span>
           {!isLocked && (
             <button 
               className="text-[#5f6c87] hover:text-[#e5ecff] text-[10px]"
               onClick={() => {
                 // Toggle filter view or something
               }}
             >
               Filters
             </button>
           )}
        </div>
        
        {/* Project Filter - Only show if not locked or if a project is selected to show context */}
        {!isLocked && (
          <select
            className="bg-[#111111] text-[#e5ecff] text-[11px] rounded border border-[#2a2a2a] p-1.5 w-full outline-none"
            value={config.projectIds?.[0] ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              onUpdateConfig({ 
                projectIds: val ? [val] : undefined 
              });
            }}
          >
            <option value="">All Projects</option>
            {projectOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent">
        {filteredTasks.length === 0 ? (
          <div className="text-center p-4 text-[#5f6c87] text-xs">
            No tasks found.
          </div>
        ) : (
          <div className="space-y-1">
            {filteredTasks.map(task => {
              const state = states.find(s => s.id === task.stateId);
              return (
                <div 
                  key={task.id} 
                  className="group flex items-center gap-2 p-2 rounded hover:bg-[#1a1a1a] border border-transparent hover:border-[#2a2a2a] transition-all cursor-pointer"
                >
                  <div 
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      task.priority === 0 ? "bg-red-500" : 
                      task.priority === 1 ? "bg-orange-500" : 
                      task.priority === 2 ? "bg-blue-500" : "bg-gray-600"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[#e5ecff] text-xs truncate leading-tight">
                      {task.title}
                    </div>
                    <div className="text-[#5f6c87] text-[10px] truncate flex items-center gap-1 mt-0.5">
                      <span>{state?.name ?? "Unknown"}</span>
                      {task.dueDate && (
                         <>
                           <span>•</span>
                           <span>{task.dueDate}</span>
                         </>
                      )}
                    </div>
                  </div>
                  <input 
                    type="checkbox" 
                    className="opacity-0 group-hover:opacity-100 transition-opacity accent-[#3a4359] cursor-pointer"
                    checked={state?.kind === 'done'}
                    onChange={(e) => {
                       // Find 'done' state for this project
                       if (e.target.checked) {
                         const doneState = states.find(s => s.projectId === task.projectId && s.kind === 'done');
                         if (doneState) {
                           updateTask(task.id, { stateId: doneState.id });
                         }
                       }
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
