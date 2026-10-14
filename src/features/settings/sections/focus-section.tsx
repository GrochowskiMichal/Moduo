import { isFocusTimerMode } from "@contracts/vocabularies";
import type { ReactNode } from "react";

import { Input } from "../../../components/ui/input";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Switch } from "../../../components/ui/switch";
import { useFocusPrefs } from "../../../lib/focus-prefs";

import { PrefGroup } from "./preferences-section";
import { SettingsSectionShell } from "./section-shell";

/**
 * Focus (Tasks v3 TV-F8, calls 59a, 62a, 63, 10; F7-17): your defaults for the
 * Timer (Per task · Pomodoro · Off, with "Count down the estimate" under Per
 * task), "Offer quick tasks along the way", your usual pace, then Pomodoro's
 * lengths. Focus's ⋯ menu changes the same settings everywhere (63); a change
 * here is the default the next session starts with. Persisted via
 * useFocusPrefs. (The Settings rebuild moves this under Tasks → Focus.)
 */
export function FocusSection() {
  const { prefs, setPrefs } = useFocusPrefs();

  return (
    <SettingsSectionShell
      title="Focus"
      description="How Focus times your work and what it offers between tasks. The timer never starts on its own."
    >
      <PrefGroup label="Timer and offers">
        <FocusRow
          title="Timer"
          description={
            prefs.timer === "off"
              ? "Off: no clock, and nothing is recorded. Focus still works."
              : prefs.timer === "pomodoro"
                ? "Pomodoro: one rhythm for the session, breaks offered between tasks. Time still goes on each task."
                : "Per task: a clock on the task you're on, and its time is recorded."
          }
        >
          <SegmentedControl
            size="sm"
            value={prefs.timer}
            onValueChange={(v) => {
              if (isFocusTimerMode(v)) setPrefs({ timer: v });
            }}
            items={[
              { value: "per_task", label: "Per task" },
              { value: "pomodoro", label: "Pomodoro" },
              { value: "off", label: "Off" },
            ]}
            aria-label="Timer"
          />
        </FocusRow>
        <FocusRow
          title="Count down the estimate"
          description="Per task: show what's left of the estimate instead of counting up."
        >
          <Switch
            checked={prefs.countdownEstimate}
            disabled={prefs.timer !== "per_task"}
            onCheckedChange={(v) => setPrefs({ countdownEstimate: v })}
            aria-label="Count down the estimate"
          />
        </FocusRow>
        <FocusRow
          title="Offer quick tasks along the way"
          description="Between two tasks in different projects, offer one task of 15 minutes or less from the project you're leaving."
        >
          <Switch
            checked={prefs.alongTheWay}
            onCheckedChange={(v) => setPrefs({ alongTheWay: v })}
            aria-label="Offer quick tasks along the way"
          />
        </FocusRow>
        <FocusRow
          title="Show my usual pace"
          description="After about ten timed tasks, Up next says how long it takes at your own pace. Only you see it."
        >
          <Switch
            checked={prefs.usualPace}
            onCheckedChange={(v) => setPrefs({ usualPace: v })}
            aria-label="Show my usual pace"
          />
        </FocusRow>
      </PrefGroup>
      <PrefGroup
        label="Pomodoro"
        description="Lengths for the Pomodoro timer. The ⋯ menu in Focus offers presets."
      >
        <FocusRow title="Work" description="Length of one focus block." htmlFor="focus-work">
          <MinutesInput
            id="focus-work"
            value={prefs.workMinutes}
            onChange={(n) => setPrefs({ workMinutes: n })}
          />
        </FocusRow>
        <FocusRow
          title="Short break"
          description="The breather between focus blocks."
          htmlFor="focus-break"
        >
          <MinutesInput
            id="focus-break"
            value={prefs.breakMinutes}
            onChange={(n) => setPrefs({ breakMinutes: n })}
          />
        </FocusRow>
        <FocusRow
          title="Long break"
          description="The longer rest after a run of blocks."
          htmlFor="focus-long-break"
        >
          <MinutesInput
            id="focus-long-break"
            value={prefs.longBreakMinutes}
            onChange={(n) => setPrefs({ longBreakMinutes: n })}
          />
        </FocusRow>
        <FocusRow
          title="Long break after"
          description="How many focus blocks earn a long break."
          htmlFor="focus-sessions"
        >
          <div className="flex items-center gap-2">
            <Input
              id="focus-sessions"
              type="number"
              min={1}
              max={12}
              size="sm"
              value={String(prefs.sessionsBeforeLongBreak)}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setPrefs({ sessionsBeforeLongBreak: n });
              }}
              className="w-20"
            />
            <span className="text-xs text-muted-foreground">blocks</span>
          </div>
        </FocusRow>
        <FocusRow
          title="Auto-start next interval"
          description="Roll straight into the next block or break instead of pausing to resume by hand."
        >
          <Switch
            checked={prefs.autoStartNext}
            onCheckedChange={(v) => setPrefs({ autoStartNext: v })}
            aria-label="Auto-start the next interval"
          />
        </FocusRow>
        <FocusRow title="Sound" description="Play a short chime when an interval ends.">
          <Switch
            checked={prefs.soundEnabled}
            onCheckedChange={(v) => setPrefs({ soundEnabled: v })}
            aria-label="Interval-end sound"
          />
        </FocusRow>
      </PrefGroup>
    </SettingsSectionShell>
  );
}

function FocusRow({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 first:pt-2 last:border-b-0 last:pb-2">
      <div className="flex flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
            {title}
          </label>
        ) : (
          <span className="text-sm font-medium text-foreground">{title}</span>
        )}
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function MinutesInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={1}
        max={180}
        size="sm"
        value={String(value)}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-20"
      />
      <span className="text-xs text-muted-foreground">min</span>
    </div>
  );
}
