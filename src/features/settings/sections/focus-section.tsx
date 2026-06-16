import type { ReactNode } from "react";

import { Input } from "../../../components/ui/input";
import { Switch } from "../../../components/ui/switch";
import { useFocusPrefs } from "../../../lib/focus-prefs";

import { SettingsSectionShell } from "./section-shell";

/** Pomodoro intervals + the Focus timer's behaviour. Persisted via
 *  useFocusPrefs; the Focus card's ⋯ popover edits the same work/break values. */
export function FocusSection() {
  const { prefs, setPrefs } = useFocusPrefs();

  return (
    <SettingsSectionShell
      title="Focus"
      description="Pomodoro intervals and how the Focus timer behaves. The timer is always opt-in — it never starts on its own."
    >
      <section className="rounded-lg border border-border bg-card px-6 py-2">
        <FocusRow title="Work" description="Length of one focus block." htmlFor="focus-work">
          <MinutesInput
            id="focus-work"
            value={prefs.workMinutes}
            onChange={(n) => setPrefs({ workMinutes: n })}
          />
        </FocusRow>
        <FocusRow title="Short break" description="The breather between focus blocks." htmlFor="focus-break">
          <MinutesInput
            id="focus-break"
            value={prefs.breakMinutes}
            onChange={(n) => setPrefs({ breakMinutes: n })}
          />
        </FocusRow>
        <FocusRow title="Long break" description="The longer rest after a run of blocks." htmlFor="focus-long-break">
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
      </section>
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
