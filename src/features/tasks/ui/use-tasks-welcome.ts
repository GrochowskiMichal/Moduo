// Tasks' welcome and the role question (TV-U17, tasks-v3 §16, REPLAN 34): when
// it opens by itself, what it seeds, and what a role answer does. The pure
// rules are in ../onboarding.ts; the dialog is tasks-welcome-dialog.tsx.
//
// - It opens by itself once per person (synced preferences), after their
//   preferences and the workspace's tasks have been read, so a new device
//   never flashes it. Someone who already made tasks here never sees it.
// - The role question comes first, once per person; then the basics.
// - The workspace's owner, in a workspace with nothing in it, gets the three
//   teaching tasks in their Inbox (once per workspace).
// - A role answer opens its first view, sets the row preset (Display), and
//   adds its starter template.
// - The sidebar's ⋯ and Help → "What's in Tasks" reopen it at the basics.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  currentPreferences,
  type TasksOnboardingPrefs,
  updatePreferences,
  usePreferencesReady,
  usePreferencesValue,
} from "../../../lib/preferences";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { formatShortcut, SHORTCUTS } from "../../../lib/shortcuts";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import {
  firstViewFor,
  ROLE_DEFAULTS,
  shouldSeedWorkspace,
  type TasksRole,
  teachingTaskTitles,
  welcomeDecision,
} from "../onboarding";
import { refreshTemplates } from "../templates/templates-store";
import { consumeTasksWelcomeRequest, TASKS_WELCOME_REQUEST_EVENT } from "../welcome-request";

/** The dialog's pages: the role question, the basics, then up to three steps. */
export type WelcomeStep = "role" | "basics" | 1 | 2 | 3;

type WelcomeApi = Pick<
  TasksModuleApi,
  | "tasks"
  | "buckets"
  | "inbox"
  | "canEdit"
  | "currentUserId"
  | "reachedServer"
  | "restLoaded"
  | "createTask"
>;

function patchOnboarding(patch: Partial<TasksOnboardingPrefs>): void {
  const now = currentPreferences().tasksOnboarding;
  updatePreferences({ tasksOnboarding: { ...now, ...patch } });
}

export type TasksWelcome = {
  open: boolean;
  step: WelcomeStep;
  setStep: (step: WelcomeStep) => void;
  close: () => void;
  /** Answer the role question (null = Skip), then show the basics. */
  chooseRole: (role: TasksRole | null) => void;
  /** The starter template the answer added ("Project kickoff"), to say where it is. */
  starterName: string | null;
  /** Reopen at the basics (the sidebar's ⋯ → What's in Tasks). */
  reopen: () => void;
};

export function useTasksWelcome({
  api,
  runtime,
  workspaceId,
  isOwner,
  onFirstView,
}: {
  api: WelcomeApi;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  /** The person owns this workspace (they made it). */
  isOwner: boolean;
  /** Open a role's first view: a sidebar place, as its Board when `board`. */
  onFirstView: (view: { selection: string; board: boolean }) => void;
}): TasksWelcome {
  const userId = api.currentUserId;
  const prefsReady = usePreferencesReady(userId);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WelcomeStep>("basics");
  const [starterName, setStarterName] = useState<string | null>(null);

  // Async steps read the module as it is by then, not as it was.
  const apiRef = useRef(api);
  const firstViewRef = useRef(onFirstView);
  useEffect(() => {
    apiRef.current = api;
    firstViewRef.current = onFirstView;
  });

  const tasksReady = api.reachedServer && api.restLoaded;
  const hasOwnTasks = useMemo(
    () => !!userId && api.tasks.some((t) => t.creatorId === userId),
    [api.tasks, userId],
  );

  // Opens by itself once per person; decided once per page and person.
  const decidedRef = useRef<string | null>(null);
  // It opened by itself on this page: the moment a new person's empty
  // workspace gets its teaching tasks.
  const [firstShow, setFirstShow] = useState(false);
  const onboardingPrefs = usePreferencesValue().tasksOnboarding;
  const welcomeSeen = !!onboardingPrefs.welcomeSeenAt;
  useEffect(() => {
    if (!userId || decidedRef.current === userId) return;
    const decision = welcomeDecision({ prefsReady, tasksReady, welcomeSeen, hasOwnTasks });
    if (decision === "wait") return;
    decidedRef.current = userId;
    if (decision === "none") return;
    // Shown once, so "seen" the moment it shows (a reload mid-way doesn't
    // bring it back; the ⋯ and Help reopen it).
    patchOnboarding({ welcomeSeenAt: new Date().toISOString() });
    if (decision === "skip-experienced") return;
    setStep(currentPreferences().tasksOnboarding.roleAt ? "basics" : "role");
    setOpen(true);
    setFirstShow(true);
  }, [userId, prefsReady, tasksReady, welcomeSeen, hasOwnTasks]);

  // The three teaching tasks, into the owner's Inbox of an empty workspace,
  // once its Inbox exists (a new workspace's is made on its first open).
  const inboxId = api.inbox?.id ?? null;
  const seedingRef = useRef(false);
  const seedNow =
    firstShow &&
    !!inboxId &&
    shouldSeedWorkspace({
      isOwner,
      canEdit: api.canEdit,
      tasksReady,
      seededAlready: !!onboardingPrefs.seeded[workspaceId],
      taskCount: api.tasks.length,
      projectCount: api.buckets.length,
    });
  useEffect(() => {
    if (!seedNow || !inboxId || seedingRef.current) return;
    seedingRef.current = true;
    // Stamped first: a second device or a reload never seeds again.
    const seeded = currentPreferences().tasksOnboarding.seeded;
    patchOnboarding({ seeded: { ...seeded, [workspaceId]: new Date().toISOString() } });
    const capture = SHORTCUTS.find((s) => s.id === "capture");
    const titles = teachingTaskTitles(capture ? formatShortcut(capture) : "⌘⇧K");
    void (async () => {
      for (const title of titles) {
        // One after another, each from the module as it is after the last
        // (positions follow the copy), so they land in this order.
        await apiRef.current.createTask({ bucketId: inboxId, title });
      }
    })();
  }, [seedNow, inboxId, workspaceId]);

  const reopen = useCallback(() => {
    setStarterName(null);
    setStep("basics");
    setOpen(true);
  }, []);

  // Help → "What's in Tasks", from this page or another.
  useEffect(() => {
    if (consumeTasksWelcomeRequest()) reopen();
    const onRequest = () => {
      consumeTasksWelcomeRequest();
      reopen();
    };
    window.addEventListener(TASKS_WELCOME_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(TASKS_WELCOME_REQUEST_EVENT, onRequest);
  }, [reopen]);

  const chooseRole = useCallback(
    (role: TasksRole | null) => {
      patchOnboarding({ role, roleAt: new Date().toISOString() });
      setStep("basics");
      if (!role) return;
      const a = apiRef.current;
      firstViewRef.current(
        firstViewFor(
          role,
          a.buckets.map((b) => b.id),
        ),
      );
      const starter = ROLE_DEFAULTS[role].starter;
      const create = runtime?.tasks.createStarterTemplate;
      if (!starter || !a.canEdit || !create) return;
      void create({ workspaceId, id: crypto.randomUUID(), starter }).then(
        (template) => {
          setStarterName(template.name);
          void refreshTemplates(runtime, workspaceId);
        },
        // A default, not something they asked for: no error toast.
        () => undefined,
      );
    },
    [runtime, workspaceId],
  );

  const close = useCallback(() => setOpen(false), []);

  return { open, step, setStep, close, chooseRole, starterName, reopen };
}
