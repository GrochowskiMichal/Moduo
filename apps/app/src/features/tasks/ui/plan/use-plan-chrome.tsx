// The plan view's chrome state: the legacy layout, the right panel's view and
// full page, the sidebar's memory (folds, hidden rows, pins, project order),
// and which dialog is open. First in `useTasksPlanController`'s chain.

import type { TaskStatusCategory } from "@contracts/vocabularies";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type TasksSidebarHideable,
  updatePreferences,
  usePreferencesValue,
} from "../../../../lib/preferences";
import type { TaskLayout } from "../../display";
import type { Bucket } from "../../model";
import { commitProjectDrop } from "../../project-order";
import { projectOrderDrop } from "../../sidebar";
import { useTaskCommands, useTasksSelector, useTasksUserId } from "../../tasks-context";
import { parseCollapsedSections } from "../bucket-rail";
import type { PlanBase } from "./plan-base";
import { EMPTY_IDS, readLS, removeLS } from "./plan-base";

export function usePlanChrome(c: PlanBase) {
  const { workspaceId, canEdit, buckets } = c;
  const userId = useTasksUserId();
  const areas = useTasksSelector((d) => d.areas);
  const { moveBucketToArea } = useTaskCommands();
  // The workspace-wide view from before layouts were per scope: a scope
  // that doesn't remember a layout yet starts with it.
  const [legacyLayout] = useState<TaskLayout>(() => {
    const stored = readLS(workspaceId, "view");
    return stored === "board" || stored === "timeline" ? stored : "list";
  });
  // The retired "Plan · Focus" switch's mode is read once by `usePlanPlace`
  // (a device left in its Focus mode opens Focus, TV-F7), then forgotten.
  useEffect(() => {
    removeLS(workspaceId, "mode");
    // The Timeline's zoom is per scope in Display since TV-TL1.
    removeLS(workspaceId, "timelineZoom");
  }, [workspaceId]);
  // The right-panel view last picked, which the panel remembers; what shows
  // is `panelActive` below (views and the rule: features/tasks/panel-views.ts).
  const [panelView, setPanelView] = useState("details");
  // The task that fills the centre (call 32), or null for the view.
  const [fullPageId, setFullPageId] = useState<string | null>(null);
  // Sidebar groups you collapsed (Pinned and each area) stay collapsed,
  // remembered per person on this device (REPLAN 29e; Customize and Pin
  // follow the person everywhere, in preferences).
  const collapseKey = `collapsedGroups:${userId ?? "anon"}`;
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() =>
    parseCollapsedSections(readLS(workspaceId, collapseKey)),
  );
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const preferences = usePreferencesValue();
  const sidebarPrefs = preferences.tasksSidebar;
  // The role question's answer (TV-U17): where Tasks first opens, the rows.
  const onboardingRole = preferences.tasksOnboarding.role;
  const hiddenRows = useMemo(() => new Set(sidebarPrefs.hidden), [sidebarPrefs.hidden]);
  const pinnedIds = sidebarPrefs.pinned[workspaceId] ?? EMPTY_IDS;
  const toggleHiddenRow = useCallback(
    (row: TasksSidebarHideable) => {
      const hidden = sidebarPrefs.hidden.includes(row)
        ? sidebarPrefs.hidden.filter((r) => r !== row)
        : [...sidebarPrefs.hidden, row];
      updatePreferences({ tasksSidebar: { ...sidebarPrefs, hidden } });
    },
    [sidebarPrefs],
  );
  // This person's own order of the projects (MOD-38, like Slack's channels):
  // synced in their preferences, so it follows them to every device and
  // never moves anyone else's sidebar.
  const projectOrder = sidebarPrefs.projectOrder[workspaceId] ?? EMPTY_IDS;
  // A sidebar drop: the new order is yours; a drop into another area also
  // files the project there for everyone, which needs edit access (without
  // it the drop does nothing).
  const moveProject = useCallback(
    (activeId: string, overId: string) => {
      const drop = projectOrderDrop(buckets, areas, projectOrder, activeId, overId, canEdit);
      if (!drop) return;
      // A refused area move takes the new order back with it.
      void commitProjectDrop(workspaceId, drop, (areaId) => moveBucketToArea(activeId, areaId));
    },
    [buckets, areas, moveBucketToArea, projectOrder, canEdit, workspaceId],
  );
  // A project's id, or a saved view's `view:<id>` (TV-U8).
  const togglePin = useCallback(
    (pinId: string) => {
      const mine = sidebarPrefs.pinned[workspaceId] ?? [];
      const next = mine.includes(pinId) ? mine.filter((id) => id !== pinId) : [...mine, pinId];
      updatePreferences({
        tasksSidebar: { ...sidebarPrefs, pinned: { ...sidebarPrefs.pinned, [workspaceId]: next } },
      });
    },
    [sidebarPrefs, workspaceId],
  );
  // A project's Delete…, Archive… and Done confirms (REPLAN 78), from the
  // sidebar, Archived projects or the overview (TV-U16). The project is kept
  // while the dialog closes.
  const [projectDialog, setProjectDialog] = useState<{
    kind: "delete" | "archive" | "done";
    bucket: Bucket;
    open: boolean;
  } | null>(null);
  const [triageBucketId, setTriageBucketId] = useState<string | null>(null);
  // Statuses (TV-D9): a project's (its ⋯, or "+ Add status" on its board), or
  // the workspace default set (the Inbox's ⋯). Null = closed.
  const [statusesEditor, setStatusesEditor] = useState<{
    projectId: string | null;
    addingTo?: TaskStatusCategory | null;
  } | null>(null);
  // Triage opens from a rail row and has no trigger to hand focus back to.
  const railNavRef = useRef<HTMLElement | null>(null);
  const triageFromRef = useRef<string | null>(null);
  // Queuing a blocked task offers its unblocked frontier first (spec §5c).
  const [frontierOfferTaskId, setFrontierOfferTaskId] = useState<string | null>(null);
  return {
    ...c,
    legacyLayout,
    panelView,
    setPanelView,
    fullPageId,
    setFullPageId,
    collapseKey,
    collapsedGroups,
    setCollapsedGroups,
    toggleGroup,
    preferences,
    sidebarPrefs,
    onboardingRole,
    hiddenRows,
    pinnedIds,
    toggleHiddenRow,
    projectOrder,
    moveProject,
    togglePin,
    projectDialog,
    setProjectDialog,
    triageBucketId,
    setTriageBucketId,
    statusesEditor,
    setStatusesEditor,
    railNavRef,
    triageFromRef,
    frontierOfferTaskId,
    setFrontierOfferTaskId,
  };
}

export type PlanChromeCtx = ReturnType<typeof usePlanChrome>;
