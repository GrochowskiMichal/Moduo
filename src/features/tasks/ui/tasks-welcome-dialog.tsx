// Tasks' welcome (TV-U17, tasks-v3 §16, REPLAN 34): the role question once per
// person, then the basics with "Learn more" / "Explore on my own", then up to
// three steps, each a short clip recorded from the real app with one or two
// sentences: (1) above the line is yours, below it is shared; (2) line things
// up in Focus; (3) `@` `#` `/`. Back / Next, progress dots, a Close that's
// always there, Esc closes. Quiet: no celebration, no forced steps. The state
// and what opens it are use-tasks-welcome.ts.

import { TASKS_ROLES, type TasksRole } from "@contracts/vocabularies";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Kbd } from "../../../components/ui/kbd";
import { useReturnFocus } from "../../../hooks/use-return-focus";
import { formatShortcut, SHORTCUTS } from "../../../lib/shortcuts";
import { cn } from "../../../lib/utils";
import { ROLE_DEFAULTS } from "../onboarding";
import { FOCUS_WHAT_IT_IS, FocusKeyHints } from "./focus-empty-state";
import type { TasksWelcome, WelcomeStep } from "./use-tasks-welcome";

/**
 * Each step's clip: frames recorded from the real app by
 * `tests/clips/welcome-clips.spec.ts` (the whole window, bottom bar included),
 * shown in turn with a cross-fade. Re-record them whenever the UI changes.
 */
export const WELCOME_CLIPS: Record<1 | 2 | 3, readonly string[]> = {
  1: ["/welcome/tasks-1-1.jpg", "/welcome/tasks-1-2.jpg", "/welcome/tasks-1-3.jpg"],
  2: ["/welcome/tasks-2-1.jpg", "/welcome/tasks-2-2.jpg", "/welcome/tasks-2-3.jpg"],
  3: [
    "/welcome/tasks-3-1.jpg",
    "/welcome/tasks-3-2.jpg",
    "/welcome/tasks-3-3.jpg",
    "/welcome/tasks-3-4.jpg",
  ],
};

/** How long each frame of a clip stays before the next fades in. */
const FRAME_MS = 1800;

const STEPS = [1, 2, 3] as const;

const CAPTURE_SHORTCUT = SHORTCUTS.find((s) => s.id === "capture");

/** Reduced motion, the app's override layered over the OS's (tokens.css). */
function wantsStillClips(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return true;
  const override = document.documentElement.getAttribute("data-motion");
  if (override === "reduced") return true;
  if (override === "full") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function WelcomeClip({ step }: { step: 1 | 2 | 3 }) {
  const frames = WELCOME_CLIPS[step];
  const [shown, setShown] = useState(0);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setShown(0);
    if (frames.length < 2 || wantsStillClips()) return;
    const timer = window.setInterval(() => setShown((n) => (n + 1) % frames.length), FRAME_MS);
    return () => window.clearInterval(timer);
  }, [frames]);
  // A clip that can't load leaves no hole: the words carry the step.
  if (broken) return null;
  return (
    <div
      aria-hidden
      data-slot="welcome-clip"
      // Below the dialog's Close (×), never under it.
      className="relative mt-6 aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted"
    >
      {frames.map((src, n) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          className={cn(
            "absolute inset-0 size-full object-cover object-top transition-opacity duration-(--motion-slow) ease-(--ease-out)",
            n === shown ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
    </div>
  );
}

function ProgressDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((n) => (
        <span
          key={n}
          aria-hidden
          className={cn(
            "size-1.5 rounded-full transition-colors duration-(--motion-fade) ease-(--ease-out)",
            n === step ? "bg-foreground" : "bg-hairline",
          )}
        />
      ))}
      <span className="sr-only">
        Step {step} of {STEPS.length}
      </span>
    </div>
  );
}

function RoleStep({ onChoose }: { onChoose: (role: TasksRole | null) => void }) {
  return (
    <>
      <DialogHeader>
        <Eyebrow as="p">Welcome to Moduo</Eyebrow>
        <DialogTitle>What will you run in Moduo?</DialogTitle>
        <DialogDescription>
          Your answer sets a few defaults, like where Tasks opens. Nothing is turned on or off.
        </DialogDescription>
      </DialogHeader>
      <ul className="grid grid-cols-2 gap-2" aria-label="What you’ll run">
        {TASKS_ROLES.map((role) => (
          <li key={role}>
            <button
              type="button"
              data-role={role}
              onClick={() => onChoose(role)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border px-3 py-2 text-left transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="font-sans text-sm text-foreground">{ROLE_DEFAULTS[role].label}</span>
              <span className="font-sans text-xs text-muted-foreground">
                {ROLE_DEFAULTS[role].hint}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onChoose(null)}>
          Skip
        </Button>
      </DialogFooter>
    </>
  );
}

function BasicsStep({
  starterName,
  onLearnMore,
  onExplore,
}: {
  starterName: string | null;
  onLearnMore: () => void;
  onExplore: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Welcome to Tasks</DialogTitle>
        <DialogDescription>
          Everything you and your team need to do, from a quick note to a whole project.
        </DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-2 font-sans text-sm text-foreground">
        <li>
          <Kbd>{CAPTURE_SHORTCUT ? formatShortcut(CAPTURE_SHORTCUT) : "⌘⇧K"}</Kbd> captures a task
          from anywhere in Moduo. It lands in your Inbox.
        </li>
        <li>
          Click a task, or press <Kbd>⏎</Kbd>, to open it beside the list.
        </li>
        <li>Focus lines up what you’ll do next and works through it, one task at a time.</li>
      </ul>
      {starterName ? (
        <p className="font-sans text-xs text-muted-foreground" data-slot="welcome-starter">
          {starterName} is in your templates: the sidebar’s ⋯, then New project from template…
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onExplore}>
          Explore on my own
        </Button>
        <Button onClick={onLearnMore}>Learn more</Button>
      </DialogFooter>
    </>
  );
}

const STEP_TITLES: Record<1 | 2 | 3, string> = {
  1: "Above the line is yours",
  2: "Line things up in Focus",
  3: "@, # and / work everywhere",
};

function StepBody({ step }: { step: 1 | 2 | 3 }) {
  if (step === 1) {
    return (
      <DialogDescription>
        Inbox, Focus, Upcoming and My tasks are yours alone. Below the line, All and your projects
        hold the work you share. File a task from your Inbox into a project, or assign it, and it
        moves there.
      </DialogDescription>
    );
  }
  if (step === 2) {
    return (
      <>
        <DialogDescription>{FOCUS_WHAT_IT_IS}</DialogDescription>
        <ul className="flex flex-col gap-1.5 font-sans text-sm text-muted-foreground">
          <FocusKeyHints where="to Focus" />
        </ul>
      </>
    );
  }
  return (
    <>
      <DialogDescription>
        Type them in a task’s name or in capture. They work the same everywhere in Moduo.
      </DialogDescription>
      <ul className="flex flex-col gap-1.5 font-sans text-sm text-muted-foreground">
        <li>
          <Kbd>@</Kbd> assigns, files and links
        </li>
        <li>
          <Kbd>#</Kbd> tags
        </li>
        <li>
          <Kbd>/</Kbd> runs commands, like <Kbd>/tomorrow</Kbd>
        </li>
      </ul>
    </>
  );
}

function LearnStep({
  step,
  onBack,
  onNext,
}: {
  step: 1 | 2 | 3;
  onBack: () => void;
  onNext: () => void;
}) {
  const last = step === STEPS.length;
  return (
    <>
      {/* Its own per step: a clip that failed to load hides only itself. */}
      <WelcomeClip key={step} step={step} />
      <DialogHeader>
        <DialogTitle>{STEP_TITLES[step]}</DialogTitle>
      </DialogHeader>
      <div className="-mt-2 flex flex-col gap-2">
        <StepBody step={step} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <ProgressDots step={step} />
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext}>{last ? "Done" : "Next"}</Button>
        </div>
      </div>
    </>
  );
}

export function TasksWelcomeDialog({ welcome }: { welcome: TasksWelcome }) {
  const { open, step, setStep, close, chooseRole, starterName } = welcome;
  const returnFocus = useReturnFocus(open);
  const go = (next: WelcomeStep) => setStep(next);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        // Closing the role question skips it (it's asked once).
        if (step === "role") chooseRole(null);
        close();
      }}
    >
      <DialogContent
        data-slot="tasks-welcome"
        className="max-w-xl"
        // Focus the dialog, not its first choice: nothing reads as picked
        // before you pick it (Tab reaches the choices in order).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        onCloseAutoFocus={returnFocus}
      >
        {step === "role" ? (
          <RoleStep onChoose={chooseRole} />
        ) : step === "basics" ? (
          <BasicsStep starterName={starterName} onLearnMore={() => go(1)} onExplore={close} />
        ) : (
          <LearnStep
            step={step}
            onBack={() => go(step === 1 ? "basics" : ((step - 1) as 1 | 2))}
            onNext={() => (step === STEPS.length ? close() : go((step + 1) as 2 | 3))}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
