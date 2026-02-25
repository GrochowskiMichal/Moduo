import { useEffect, useMemo, useState } from "react";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

type CountdownParts = {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
  isComplete: boolean;
};

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsClamped(base: Date, months: number): Date {
  const year = base.getFullYear();
  const month = base.getMonth();
  const targetMonth = month + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const next = new Date(base);
  const day = Math.min(base.getDate(), lastDayOfMonth(targetYear, normalizedMonth));
  next.setFullYear(targetYear, normalizedMonth, day);
  return next;
}

function computeCountdown(now: Date, target: Date): CountdownParts {
  if (!(target instanceof Date) || Number.isNaN(target.getTime()) || target.getTime() <= now.getTime()) {
    return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, isComplete: true };
  }

  let cursor = new Date(now);
  let years = 0;
  while (true) {
    const next = addMonthsClamped(cursor, 12);
    if (next.getTime() > target.getTime()) break;
    cursor = next;
    years += 1;
  }

  let months = 0;
  while (true) {
    const next = addMonthsClamped(cursor, 1);
    if (next.getTime() > target.getTime()) break;
    cursor = next;
    months += 1;
  }

  let days = 0;
  while (true) {
    const next = new Date(cursor);
    next.setDate(next.getDate() + 1);
    if (next.getTime() > target.getTime()) break;
    cursor = next;
    days += 1;
  }

  const remainingMs = Math.max(0, target.getTime() - cursor.getTime());
  const totalSeconds = Math.floor((target.getTime() - now.getTime()) / 1000);
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);

  return { years, months, days, hours, minutes, seconds, totalSeconds, isComplete: false };
}

function toDateTimeLocalValue(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

function formatTarget(iso?: string): string {
  if (!iso) return "No target date selected";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid target date";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function parseLocalDateTime(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    const date = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s ?? "0"),
      0
    );
    if (!Number.isNaN(date.getTime())) return date;
  }

  // Fallback for webviews/browsers that expose localized datetime strings.
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function CountdownWidget({ config, isLocked, onUpdateConfig }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [inputValue, setInputValue] = useState(() => toDateTimeLocalValue(config.countdownTargetIso));
  const [draftTargetMs, setDraftTargetMs] = useState<number | null>(() => {
    const parsed = config.countdownTargetIso ? new Date(config.countdownTargetIso) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null;
  });
  const displayTitle = (config.countdownTitle ?? "").trim() || "Countdown";
  const hasTitle = (config.countdownTitle ?? "").trim().length > 0;

  useEffect(() => {
    setInputValue(toDateTimeLocalValue(config.countdownTargetIso));
    const parsed = config.countdownTargetIso ? new Date(config.countdownTargetIso) : null;
    setDraftTargetMs(parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : null);
  }, [config.countdownTargetIso]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const target = useMemo(() => {
    if (!config.countdownTargetIso) return null;
    const parsed = new Date(config.countdownTargetIso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [config.countdownTargetIso]);
  const isActive = config.countdownActive === true && !!target;

  const countdown = useMemo(
    () => (target ? computeCountdown(now, target) : { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, isComplete: false }),
    [now, target]
  );
  const units = useMemo(() => {
    const ordered = [
      { label: "Years", value: countdown.years },
      { label: "Months", value: countdown.months },
      { label: "Days", value: countdown.days },
      { label: "Hours", value: countdown.hours },
      { label: "Minutes", value: countdown.minutes },
      { label: "Seconds", value: countdown.seconds },
    ];
    if (!isActive) return ordered.slice(3);
    const firstNonZeroIndex = ordered.findIndex((unit) => unit.value > 0);
    if (countdown.isComplete || firstNonZeroIndex === -1) return [{ label: "Seconds", value: 0 }];
    return ordered.slice(firstNonZeroIndex);
  }, [countdown, isActive]);

  return (
    <WidgetShell config={config} title={displayTitle}>
      {!isLocked ? (
        <div className="flex h-full items-center justify-center px-3 py-3">
          <div className="flex w-full max-w-[420px] flex-col gap-2">
            <input
              type="text"
              value={config.countdownTitle ?? ""}
              onChange={(event) => onUpdateConfig({ countdownTitle: event.target.value })}
              placeholder="Title"
              className="w-full rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#cfcfcf] outline-none"
            />
            <div className="flex w-full flex-wrap items-center justify-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={inputValue}
              placeholder="YYYY-MM-DDTHH:mm:ss"
              onChange={(event) => {
                const value = event.target.value;
                setInputValue(value);
                if (!value) {
                  setDraftTargetMs(null);
                  onUpdateConfig({ countdownTargetIso: undefined, countdownActive: false });
                  return;
                }
                const parsed = parseLocalDateTime(value);
                setDraftTargetMs(parsed ? parsed.getTime() : null);
                // Editing datetime should stop current countdown until Start is pressed again.
                onUpdateConfig({ countdownActive: false });
              }}
              className="min-w-[150px] flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#cfcfcf] outline-none selection:bg-[#24553a] selection:text-[#e7fff2]"
            />
            <button
              type="button"
              disabled={draftTargetMs == null || !hasTitle}
              onClick={() => {
                if (draftTargetMs == null || !hasTitle) return;
                onUpdateConfig({ countdownTargetIso: new Date(draftTargetMs).toISOString(), countdownActive: true });
              }}
              className={`rounded border px-3 py-1.5 text-[11px] ${
                draftTargetMs != null && hasTitle
                  ? config.countdownActive
                    ? "border-[#24553a] bg-[#163324] text-[#9fe2bc]"
                    : "border-[#2b2b2b] bg-[#141414] text-[#d8d8d8] hover:bg-[#1b1b1b]"
                  : "cursor-not-allowed border-[#232323] bg-[#121212] text-[#666666]"
              }`}
            >
              {config.countdownActive ? "Started" : "Start"}
            </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col px-3 py-3">
          <p className="truncate text-[11px] text-[#8f8f8f]">Target: {formatTarget(config.countdownTargetIso)}</p>
          <div
            className="mt-3 grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))" }}
          >
            {units.map((unit) => (
              <Unit key={unit.label} label={unit.label} value={unit.value} />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#777777]">
            {target
              ? !isActive
                ? "Press Start to begin countdown."
                : countdown.isComplete
                ? "Countdown complete."
                : `${countdown.totalSeconds.toLocaleString()} total seconds remaining`
              : "Set a date and time to start the countdown."}
          </p>
        </div>
      )}
    </WidgetShell>
  );
}

function Unit({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#252525] bg-[#151515] px-2 py-2 text-center">
      <p className="text-[19px] font-semibold leading-none text-[#f1f1f1]">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-[#8a8a8a]">{label}</p>
    </div>
  );
}
