import type { AppChromeMenusProps } from "./app-chrome-menu-types";
import { GridSceneMenu } from "./app-chrome-grid-menu";
import { TasksProjectMenu } from "./app-chrome-tasks-menu";
import { MindmapMenu } from "./app-chrome-mindmap-menu";
import { BrainstormMenu } from "./app-chrome-brainstorm-menu";

export function AppChromeMenus({ grid, tasks, mindmap, brainstorm }: AppChromeMenusProps) {
  return (
    <>
      <GridSceneMenu grid={grid} />

      <TasksProjectMenu tasks={tasks} />

      <MindmapMenu mindmap={mindmap} />

      <BrainstormMenu brainstorm={brainstorm} />
    </>
  );
}
