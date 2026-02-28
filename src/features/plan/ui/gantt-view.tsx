import type { Task } from "../../tasks/types";
import { TasksGantt } from "../../tasks/ui/tasks-gantt";

export function GanttView({
  tasks,
  selectedTaskId,
  projectNameById,
  onSelectTask,
}: {
  tasks: Task[];
  selectedTaskId: string | null;
  projectNameById: Map<string, string>;
  onSelectTask: (id: string) => void;
}) {
  return (
    <div className="flex-1 h-full min-h-0">
      <TasksGantt tasks={tasks} selectedTaskId={selectedTaskId} projectNameById={projectNameById} onSelectTask={onSelectTask} />
    </div>
  );
}
