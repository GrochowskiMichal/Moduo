// The cursor and the place: the task selection beside the multi-select set,
// the deep link's machine, `?place=` (`usePlanPlace`), Focus requests, new
// views and onboarding's first view.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { currentPreferences } from "../../../../lib/preferences";
import { readViewPrefs, writeViewPrefs } from "../../../../lib/view-prefs";
import { consumeFocusViewRequest, FOCUS_VIEW_REQUEST_EVENT } from "../../../focus/view-request";
import { useReferenceStore } from "../../../spine/references/context";
import { WorkspaceContext } from "../../../workspaces/workspace-context";
import { sanitizeTasksView, tasksDisplayKey, tasksViewDefaults } from "../../display";
import { defaultRowsFor, firstViewFor } from "../../onboarding";
import { viewSelection } from "../../views";
import { NEW_VIEW_SELECTION } from "../bucket-rail";
import { useTaskSelection } from "../use-task-selection";
import { useTasksWelcome } from "../use-tasks-welcome";
import { writeLS } from "./plan-base";
import type { PlanChromeCtx } from "./use-plan-chrome";
import { usePlanPlace } from "./use-plan-place";
import { useDeepLinkMachine } from "./use-task-deep-link";

export function usePlanSelection(c: PlanChromeCtx) {
  const {
    api,
    workspaceId,
    runtime,
    urlTaskId,
    urlPlace,
    onUrlPlaceChange,
    buckets,
    inbox,
    legacyLayout,
    setFullPageId,
    collapseKey,
    collapsedGroups,
    onboardingRole,
  } = c;
  // Task-level selection (distinct from `selection`, which is the bucket scope).
  // Lifted here so the right-rail detail panel can bind to it across List/Board.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Several selected (TV-U12): a set beside the cursor (selection.ts); the
  // views pass their order with each gesture.
  const multiSelect = useTaskSelection(selectedTaskId, setSelectedTaskId);
  // The order the List or the Board shows now (they write it as they draw):
  // the Inbox's cursor after a triage, and a selection's order.
  const viewOrderRef = useRef<readonly string[]>([]);
  // DF-1 — the cursor is STATE mirrored into the URL (not URL-derived like
  // notes NO-3): it's a j/k key-repeat cursor that mustn't ride the router on
  // every press, and WebKit hard-throttles history.replaceState (~100/30s).
  // Which id in the URL is a link and which is the mirror's own write, a
  // handle's lookup and its retry, are one state machine (`plan/deep-link.ts`).
  // While a link waits, the backstop, the mirror and the default place hold
  // (`inboundPending`, read at render so every effect in the flush agrees).
  const deepLink = useDeepLinkMachine(urlTaskId);
  const inboundPending = !deepLink.settled;
  const scrollTargetRef = useRef<string | null>(null);
  const taskKey = useContext(WorkspaceContext)?.selectedWorkspace?.taskKey ?? null;
  const referenceStore = useReferenceStore();
  // One-shot reveal request for the List view: expand a collapsed group ONCE
  // for a deep-link target — ordinary selection fallbacks never touch
  // collapse state (a group the user closes stays closed).
  const [revealRequest, setRevealRequest] = useState<{ id: string; seq: number } | null>(null);
  // An opened link to a task you can't see: the panel says "Private item"
  // until you move to another task (TV-P0, AC1.10). The scope's first pick on
  // arrival (from no selection) doesn't count as moving.
  const [privateLinkId, setPrivateLinkId] = useState<string | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedTaskId;
    if (prev !== null && prev !== selectedTaskId) setPrivateLinkId(null);
  }, [selectedTaskId]);

  // Focus time is saved by the app shell's sink (TV-P0, use-focus-time-saver.ts),
  // from any page; the module shows each saved total (FOCUS_TIME_SAVED_EVENT).

  // Persist preferences (the Timeline's zoom is per scope now, in Display: TV-TL1).
  useEffect(
    () => writeLS(workspaceId, collapseKey, JSON.stringify([...collapsedGroups])),
    [workspaceId, collapseKey, collapsedGroups],
  );

  const inboxId = inbox?.id ?? null;

  // The place open in the centre (DF-1): the address bar's `?place=`, else
  // where you left Tasks, a first open's onboarding view, or the Inbox
  // (REPLAN 30, TV-U17; `resolveEntryPlace`). A pick writes the address bar.
  const bucketIds = useMemo(() => buckets.map((b) => b.id), [buckets]);
  const archivedBucketIds = useMemo(
    () => api.archivedBuckets.map((b) => b.id),
    [api.archivedBuckets],
  );
  const viewSelections = useMemo(
    () => (api.views ?? []).map((v) => viewSelection(v.id)),
    [api.views],
  );
  const { place: selection, setPlace: setSelection } = usePlanPlace({
    workspaceId,
    urlPlace,
    onUrlPlaceChange,
    inboxId,
    bucketIds,
    archivedBucketIds,
    viewSelections,
    // A first open follows onboarding (TV-U17): the role's first view.
    firstView: onboardingRole ? firstViewFor(onboardingRole, bucketIds).selection : null,
    loaded: !api.loading,
    reachedServer: api.reachedServer,
    // DF-1: an inbound deep link owns the entry scope; the default waits.
    holdDefault: inboundPending,
  });

  // The top-bar timer's "open Focus" (and a "Focus on this" toast's Open)
  // opens the sidebar's Focus (TV-F7; it was the Plan · Focus switch). The
  // one-shot flag covers a fresh mount (clicked from another route, the event
  // fired before this listener existed); the event covers a /tasks already
  // open. Both consume the flag, so a stale one can't force Focus on a later,
  // unrelated visit.
  const openFocus = useCallback(() => {
    setFullPageId(null);
    setSelection("today");
  }, [setSelection, setFullPageId]);

  // The Views header's + (MOD-142): a new blank view, named when it's saved.
  // Each one starts blank, even right after another.
  const [newViewSeq, setNewViewSeq] = useState(0);
  const startNewView = useCallback(() => {
    setNewViewSeq((n) => n + 1);
    setFullPageId(null);
    setSelection(NEW_VIEW_SELECTION);
  }, [setSelection, setFullPageId]);
  useEffect(() => {
    if (consumeFocusViewRequest()) openFocus();
    const onRequest = () => {
      consumeFocusViewRequest();
      openFocus();
    };
    window.addEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
  }, [openFocus]);

  // Tasks' welcome and the role question (TV-U17). A role's first view can
  // be a project's Board: that project's Display remembers Board, then it
  // opens.
  const workspaceRole = useContext(WorkspaceContext)?.selectedWorkspace?.role ?? null;
  const isWorkspaceOwner = workspaceRole === "owner";
  const openFirstView = useCallback(
    ({ selection: place, board }: { selection: string; board: boolean }) => {
      if (board) {
        const key = tasksDisplayKey(workspaceId, place);
        const defaults = tasksViewDefaults(
          place,
          legacyLayout,
          defaultRowsFor(currentPreferences().tasksOnboarding.role),
        );
        const prefs = readViewPrefs(key, defaults, (raw, d) => sanitizeTasksView(raw, d, place));
        writeViewPrefs(key, { ...prefs, layout: "board" });
      }
      setFullPageId(null);
      setSelection(place);
    },
    [workspaceId, legacyLayout, setSelection, setFullPageId],
  );
  const welcome = useTasksWelcome({
    api,
    runtime,
    workspaceId,
    isOwner: isWorkspaceOwner,
    onFirstView: openFirstView,
  });
  return {
    ...c,
    selectedTaskId,
    setSelectedTaskId,
    multiSelect,
    viewOrderRef,
    deepLink,
    inboundPending,
    scrollTargetRef,
    taskKey,
    referenceStore,
    revealRequest,
    setRevealRequest,
    privateLinkId,
    setPrivateLinkId,
    prevSelectedRef,
    inboxId,
    bucketIds,
    archivedBucketIds,
    viewSelections,
    selection,
    setSelection,
    openFocus,
    newViewSeq,
    setNewViewSeq,
    startNewView,
    workspaceRole,
    isWorkspaceOwner,
    openFirstView,
    welcome,
  };
}

export type PlanSelectionCtx = ReturnType<typeof usePlanSelection>;
