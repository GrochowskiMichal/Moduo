// Task templates in capture (TV-D15, `/template` and More → "Template…"):
// the choices come from the workspace's template list; Create makes the task
// and its subtasks from the template on the server, settled into the shared
// store in one step (`applyTaskTemplate`).

import { toast } from "sonner";

import type { CaptureTemplateChoice, CaptureTemplateProvider } from "../capture/capture-hooks";
import type { Template } from "./model";
import { applyTaskTemplate } from "./ops";
import { useTemplates } from "./templates-store";

export function captureChoiceOf(t: Template): CaptureTemplateChoice {
  return {
    id: t.id,
    name: t.name,
    title: t.facts.title,
    subtasks: Math.max(0, t.facts.tasks - 1),
    dated: t.facts.dated,
    anchor: t.facts.anchor,
    project: t.facts.project,
  };
}

export const taskTemplatesForCapture: CaptureTemplateProvider = {
  useChoices(runtime, workspaceId) {
    const supported = Boolean(runtime?.tasks.applyTaskTemplate);
    const { templates, loaded } = useTemplates(runtime, supported ? workspaceId : null);
    return {
      loaded,
      choices: templates.filter((t) => t.kind === "task").map(captureChoiceOf),
    };
  },
  async apply(deps, input) {
    const outcome = await applyTaskTemplate(deps, input.templateId, {
      id: input.id,
      title: input.title,
      ...(input.projectId !== undefined
        ? { projectId: input.projectId, sectionId: input.sectionId ?? null }
        : {}),
      date: input.date,
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    });
    if (!outcome.ok) {
      toast.error(outcome.message);
      return null;
    }
    return outcome.taskIds[0] ?? input.id;
  },
};
