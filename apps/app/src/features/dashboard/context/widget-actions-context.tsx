// DB-6 — the widget actions context: carries a widget's config-write path down to
// its body without prop-drilling through pager → canvas → frame. DashboardPage
// provides it (wired to the layout hook's `updateWidgetConfig`); WidgetBody binds
// it to the widget id and passes it as `updateConfig`. Self-configuring widgets
// (Weather city, Countdown target, Pinned entity) persist through it now; DB-8's
// config popover reuses the same path. Defaults to a no-op (story-safe).

import { createContext, type ReactNode, useContext } from "react";

export interface WidgetActions {
  updateConfig: (widgetId: string, patch: Record<string, unknown>) => void;
}

const NOOP_ACTIONS: WidgetActions = { updateConfig: () => {} };

const WidgetActionsContext = createContext<WidgetActions>(NOOP_ACTIONS);

export function WidgetActionsProvider({
  actions,
  children,
}: {
  actions: WidgetActions;
  children: ReactNode;
}) {
  return <WidgetActionsContext.Provider value={actions}>{children}</WidgetActionsContext.Provider>;
}

export function useWidgetActions(): WidgetActions {
  return useContext(WidgetActionsContext);
}
