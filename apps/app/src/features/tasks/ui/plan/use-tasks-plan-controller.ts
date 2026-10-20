// The plan view's state and wiring, in the order it always ran: every hook
// and effect below is called in the same order as when this was one
// component, so the effects that race (the default place, the deep link, the
// backstop, the mirror) still settle the same way. Each step hands the next
// everything before it.

import { type PlanBase, planBase, type TasksPlanViewProps } from "./plan-base";
import { usePlanActions } from "./use-plan-actions";
import { usePlanCentre } from "./use-plan-centre";
import { usePlanChrome } from "./use-plan-chrome";
import { usePlanCursor } from "./use-plan-cursor";
import { usePlanPanelState } from "./use-plan-panel-state";
import { usePlanScope } from "./use-plan-scope";
import { usePlanSelection } from "./use-plan-selection";

export function useTasksPlanController(props: TasksPlanViewProps) {
  const base: PlanBase = planBase(props);
  // Panels, layout, the sidebar's memory and dialogs' open state.
  const chrome = usePlanChrome(base);
  // The cursor, the place (`?place=`), the deep link's machine, Focus requests.
  const selection = usePlanSelection(chrome);
  // What the place shows: Display, filters, the views built on the List.
  const scope = usePlanScope(selection);
  // Bulk, capture, queue, rail drops, project actions, templates, import.
  const actions = usePlanActions(scope);
  // The selected task, the backstop and the deep link's wiring.
  const cursor = usePlanCursor(actions);
  // The toolbar, the views' props, the Timeline's permissions, the panel stack.
  const centre = usePlanCentre(cursor);
  // The full page and what the right panel shows.
  return usePlanPanelState(centre);
}

export type PlanController = ReturnType<typeof useTasksPlanController>;
