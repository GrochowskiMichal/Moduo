// Saved views on the Tasks page (TV-U8): what the sidebar's Views group and
// a view's ⋯ do, "Save as view…" in the toolbar's ⋯, the toolbar's Save while
// a view has unsaved changes, a new blank view from the Views header's +
// (MOD-142), a `?view=` link opening its view, and onboarding's seeded views
// (once per person and workspace).

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  currentPreferences,
  updatePreferences,
  usePreferencesReady,
  usePreferencesValue,
} from "../../../lib/preferences";
import type { TasksViewPrefs } from "../display";
import { useSavedViewOps, useTasksStatus } from "../tasks-context";
import {
  freeViewName,
  seedViewsFor,
  shouldSeedViews,
  type TaskView,
  viewPlace,
  viewScopeOf,
  viewSelection,
} from "../views";
import type { ViewActions } from "./bucket-rail";
import { SaveViewDialog, type ViewSaveAction, ViewSaveControl } from "./saved-view-parts";

/** A view's link: `/tasks?view=<id>`. */
export function viewLink(viewId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/tasks?view=${encodeURIComponent(viewId)}`;
}

type Dialog = { kind: "new"; initialName: string } | null;

const NO_VIEWS: readonly TaskView[] = [];

export function useSavedViews({
  workspaceId,
  userId,
  place,
  openView,
  drafting = false,
  onNewView,
  prefs,
  dirty,
  revert,
  placeTitle,
  projectIds,
  onOpen,
  urlViewId,
  onUrlViewConsumed,
  canShare,
  canModerate,
}: {
  workspaceId: string;
  userId: string | null;
  /** The place the centre shows ("all", "mine", "upcoming", a project id, …). */
  place: string;
  openView: TaskView | null;
  /** The centre shows a new, not yet saved view (MOD-142): named on Save. */
  drafting?: boolean;
  /** Opens a new blank view (the Views header's +). */
  onNewView?: () => void;
  /** The Filter and Display as they are now. */
  prefs: TasksViewPrefs;
  dirty: boolean;
  revert: () => void;
  /** The place's own name ("All", the project's name). */
  placeTitle: string;
  projectIds: readonly string[];
  /** Open a sidebar selection. */
  onOpen: (selection: string) => void;
  /** `?view=` in the URL, or null. */
  urlViewId: string | null;
  onUrlViewConsumed: () => void;
  canShare: boolean;
  canModerate: boolean;
}): {
  viewActions: ViewActions;
  /** The toolbar ⋯'s first item, where a view can be saved. */
  saveAsMenu?: { label: string; onSelect: () => void };
  /** The toolbar's Save while an open view has unsaved changes, or a new
   *  view waits for its name (MOD-142). */
  viewSave?: ReactNode;
  dialog: ReactNode;
} {
  const [dialog, setDialog] = useState<Dialog>(null);
  const ops = useSavedViewOps();
  // A module without saved views (stories, older doubles) offers none.
  const views = ops.views ?? NO_VIEWS;
  const supported = !!ops.saveView;
  // What a new view looks at: the open view's place, or the place itself.
  const target = viewScopeOf(place, projectIds);

  const openSave = useCallback(() => {
    // A new view is named now: the field starts empty.
    if (drafting) {
      setDialog({ kind: "new", initialName: "" });
      return;
    }
    const base = openView ? `${openView.name} copy` : placeTitle;
    setDialog({ kind: "new", initialName: freeViewName(base, views) });
  }, [drafting, openView, placeTitle, views]);

  const save = useCallback(
    async (name: string): Promise<boolean> => {
      if (!target) return false;
      const view = await ops.saveView({
        name,
        scope: target.scope,
        projectId: target.projectId,
        prefs,
      });
      if (!view) return false;
      // The place keeps its own Filter and Display; an open view's (or a new
      // view's) unsaved choices went into the new one.
      if (openView || drafting) revert();
      onOpen(viewSelection(view.id));
      return true;
    },
    [ops, target, prefs, openView, drafting, revert, onOpen],
  );

  const saveChanges = useCallback(() => {
    if (!openView) return;
    void ops.saveViewChanges(openView.id, prefs).then((ok) => {
      if (ok) revert();
    });
  }, [ops, openView, prefs, revert]);

  const copyLink = useCallback((viewId: string) => {
    const link = viewLink(viewId);
    if (!navigator.clipboard) {
      toast.error("Couldn’t copy the link.");
      return;
    }
    void navigator.clipboard.writeText(link).then(
      () => toast("Link copied", { description: "It opens the view for anyone who can see it." }),
      () => toast.error("Couldn’t copy the link."),
    );
  }, []);

  const deleteView = useCallback(
    (viewId: string) => {
      // Deleting the view you're on lands on its place (a refused delete
      // brings the view back in the sidebar; you stay where you are).
      if (openView?.id === viewId) onOpen(viewPlace(openView));
      ops.deleteView(viewId);
    },
    [ops, openView, onOpen],
  );

  const viewActions = useMemo<ViewActions>(
    () => ({
      currentUserId: userId,
      onRename: ops.renameView,
      onShare: ops.shareView,
      onDelete: deleteView,
      onMove: ops.moveView,
      onCopyLink: copyLink,
      // A build without saved views makes none (MOD-142).
      onNew: supported ? onNewView : undefined,
      canShare,
      canModerate,
    }),
    [
      userId,
      ops.renameView,
      ops.shareView,
      deleteView,
      ops.moveView,
      copyLink,
      supported,
      onNewView,
      canShare,
      canModerate,
    ],
  );

  // ── ?view=<id> ──────────────────────────────────────────────────────────
  const { reachedServer } = useTasksStatus();
  useEffect(() => {
    if (!urlViewId) return;
    const view = views.find((v) => v.id === urlViewId);
    if (view) {
      onOpen(viewSelection(view.id));
      onUrlViewConsumed();
      return;
    }
    // Only once the server answered is a missing view really not there (a
    // view you can't see reads the same as one that doesn't exist).
    if (!reachedServer) return;
    toast("That view isn’t available", {
      description: "It was deleted, or it isn’t shared with you.",
    });
    onUrlViewConsumed();
  }, [urlViewId, views, reachedServer, onOpen, onUrlViewConsumed]);

  // ── onboarding's views (TV-U17's role defaults, AC4.8) ──────────────────
  const prefsReady = usePreferencesReady(userId);
  const onboarding = usePreferencesValue().tasksOnboarding;
  const seedingRef = useRef<string | null>(null);
  const seedNow =
    supported &&
    shouldSeedViews({
      prefsReady,
      reachedServer,
      onboardingDecided: !!(onboarding.roleAt || onboarding.welcomeSeenAt),
      seededAlready: !!onboarding.viewsSeeded[workspaceId],
    });
  useEffect(() => {
    if (!seedNow || seedingRef.current === workspaceId) return;
    seedingRef.current = workspaceId;
    const role = currentPreferences().tasksOnboarding.role;
    // Stamped once the server answered for every seed: an older server or a
    // lost connection leaves it for the next open. Two devices at once make
    // nothing twice (the server keeps one per person, workspace and seed).
    void ops.seedViews(seedViewsFor(role)).then((done) => {
      if (!done) return;
      const now = currentPreferences().tasksOnboarding;
      updatePreferences({
        tasksOnboarding: {
          ...now,
          viewsSeeded: { ...now.viewsSeeded, [workspaceId]: new Date().toISOString() },
        },
      });
    });
  }, [seedNow, workspaceId, ops.seedViews]);

  // Your view; a shared one only with Tasks edit (it changes what others see).
  const canSaveInto = !!openView && openView.ownerId === userId && (canShare || !openView.shared);
  const revertAction: ViewSaveAction = { label: "Revert changes", onSelect: revert };
  const saveAsNew: ViewSaveAction | null = target
    ? { label: "Save as new view…", onSelect: openSave }
    : null;
  // The toolbar's Save (MOD-142): a new view's first save; your view's Save
  // with the other two in its ▾; someone else's view saves only as a new one.
  let viewSave: ReactNode;
  if (supported && drafting && target) {
    viewSave = (
      <ViewSaveControl
        primary={{ label: "Save view…", onSelect: openSave }}
        more={dirty ? [revertAction] : []}
      />
    );
  } else if (openView && dirty) {
    viewSave = canSaveInto ? (
      <ViewSaveControl
        primary={{ label: "Save", onSelect: saveChanges }}
        more={saveAsNew ? [saveAsNew, revertAction] : [revertAction]}
      />
    ) : (
      <ViewSaveControl primary={saveAsNew ?? revertAction} more={saveAsNew ? [revertAction] : []} />
    );
  }
  return {
    viewActions,
    // A new view saves from its own button.
    saveAsMenu:
      supported && target && !drafting
        ? { label: openView ? "Save as new view…" : "Save as view…", onSelect: openSave }
        : undefined,
    viewSave,
    dialog: (
      <SaveViewDialog
        open={dialog !== null}
        title={openView ? "Save as a new view" : drafting ? "Name this view" : "Save as view"}
        description={
          target?.scope === "mine"
            ? "Keeps this Filter and Display over My tasks. Everyone sees their own tasks through it."
            : target?.scope === "upcoming"
              ? "Keeps this Filter and Display over Upcoming. Everyone sees their own dates through it."
              : target?.scope === "project"
                ? "Keeps this project with this Filter and Display. It’s yours until you share it."
                : "Keeps this Filter and Display over All. It’s yours until you share it."
        }
        initialName={dialog?.initialName ?? ""}
        onSave={save}
        onClose={() => setDialog(null)}
      />
    ),
  };
}
