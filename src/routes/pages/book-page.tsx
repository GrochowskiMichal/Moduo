/**
 * Public booking page (/book/$slug). No account. The guest picks a day, then
 * a time, then confirms. The meeting is a Google Meet.
 */

import { useParams } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import {
  type BookingPreview,
  bookingRequest,
  GUEST_ZONES,
} from "../../features/calendar/booking/public-client";
import { cn } from "../../lib/utils";

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; preview: BookingPreview }
  | { kind: "booked"; start: string; meetLink: string };

type Ymd = { y: number; m: number; d: number };

const WEEKDAY_HEAD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function detectedZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return GUEST_ZONES.includes(zone) ? zone : zone;
}

function zoneKey(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function zoneYmd(date: Date, timeZone: string): Ymd {
  const key = zoneKey(date, timeZone);
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

function cellKey(cell: Ymd): string {
  return `${cell.y}-${String(cell.m).padStart(2, "0")}-${String(cell.d).padStart(2, "0")}`;
}

function monthCells(year: number, month: number): Array<Ymd & { inMonth: boolean }> {
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<Ymd & { inMonth: boolean }> = [];
  for (let i = 0; i < startWeekday; i++) {
    const date = new Date(Date.UTC(year, month - 1, 1 - (startWeekday - i)));
    cells.push({
      y: date.getUTCFullYear(),
      m: date.getUTCMonth() + 1,
      d: date.getUTCDate(),
      inMonth: false,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ y: year, m: month, d, inMonth: true });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const date = new Date(Date.UTC(last.y, last.m - 1, last.d + 1));
    cells.push({
      y: date.getUTCFullYear(),
      m: date.getUTCMonth() + 1,
      d: date.getUTCDate(),
      inMonth: false,
    });
  }
  return cells;
}

function shiftMonth(cursor: Ymd, delta: number): Ymd {
  const date = new Date(Date.UTC(cursor.y, cursor.m - 1 + delta, 1));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: 1 };
}

function monthTitle(cursor: Ymd): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(cursor.y, cursor.m - 1, 1)));
}

function dayTitle(key: string, timeZone: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function timeLabel(slot: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(slot));
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-start justify-center bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12">
      <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </main>
  );
}

export function BookPage() {
  const { slug } = useParams({ from: "/book/$slug" });
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [zone, setZone] = useState(detectedZone);
  const [cursor, setCursor] = useState<Ymd | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const res = await bookingRequest({ action: "preview", slug });
        if (!active) return;
        if (res.status === 404) return setPhase({ kind: "missing" });
        if (!res.ok) return setPhase({ kind: "error" });
        const preview = res.json as unknown as BookingPreview;
        if (!preview || typeof preview.name !== "string") return setPhase({ kind: "missing" });
        setPhase({ kind: "ready", preview: { ...preview, slots: preview.slots ?? [] } });
      } catch {
        if (active) setPhase({ kind: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  const zones = useMemo(() => {
    return GUEST_ZONES.includes(zone) ? GUEST_ZONES : [zone, ...GUEST_ZONES];
  }, [zone]);

  const byDay = useMemo(() => {
    const map = new Map<string, string[]>();
    if (phase.kind !== "ready") return map;
    for (const slot of phase.preview.slots) {
      const key = zoneKey(new Date(slot), zone);
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return map;
  }, [phase, zone]);

  const firstKey = byDay.keys().next().value as string | undefined;
  const firstMonth = firstKey
    ? {
        y: Number(firstKey.slice(0, 4)),
        m: Number(firstKey.slice(5, 7)),
        d: 1,
      }
    : phase.kind === "ready"
      ? zoneYmd(new Date(), zone)
      : { y: 2026, m: 1, d: 1 };
  const view = cursor ?? firstMonth;
  const cells = monthCells(view.y, view.m);
  const monthKeys = cells.filter((cell) => cell.inMonth && byDay.has(cellKey(cell))).map(cellKey);
  const activeKey = dayKey && byDay.has(dayKey) ? dayKey : (monthKeys[0] ?? null);
  const times = activeKey ? (byDay.get(activeKey) ?? []) : [];

  const book = async () => {
    if (phase.kind !== "ready" || !start) return;
    setSubmitting(true);
    setFormError(null);
    const questions = phase.preview.questions ?? [];
    const res = await bookingRequest({
      action: "book",
      slug,
      start,
      timeZone: zone,
      name,
      email,
      note,
      origin: window.location.origin,
      answers: questions.map((question) => ({
        id: question.id,
        value: question.id ? (answers[question.id] ?? "") : "",
      })),
    });
    setSubmitting(false);
    if (!res.ok) {
      setFormError(
        res.json.error === "slot_taken"
          ? "That time was just taken. Pick another."
          : "Could not book that time. Try again.",
      );
      if (res.json.error === "slot_taken") setStart(null);
      return;
    }
    setPhase({
      kind: "booked",
      start: String(res.json.start ?? start),
      meetLink: String(res.json.meetLink ?? ""),
    });
  };

  if (phase.kind === "loading") {
    return (
      <Frame>
        <div className="flex flex-col gap-3 p-8">
          <div className="h-4 w-24 rounded-md bg-muted" />
          <div className="h-6 w-48 rounded-md bg-muted" />
          <div className="h-4 w-64 rounded-md bg-muted" />
        </div>
      </Frame>
    );
  }

  if (phase.kind === "missing" || phase.kind === "error") {
    return (
      <Frame>
        <div className="flex flex-col gap-2 p-8">
          <h1 className="font-display text-lg text-foreground">
            {phase.kind === "missing" ? "This link is not available" : "Could not load times"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {phase.kind === "missing"
              ? "Ask the host for a new booking link."
              : "Refresh the page and try again."}
          </p>
        </div>
      </Frame>
    );
  }

  if (phase.kind === "booked") {
    return (
      <Frame>
        <div className="flex max-w-md flex-col gap-4 p-8">
          <h1 className="font-display text-xl text-foreground">You're booked</h1>
          <p className="font-sans text-sm text-foreground tabular-nums">
            {new Intl.DateTimeFormat(undefined, {
              timeZone: zone,
              dateStyle: "full",
              timeStyle: "short",
            }).format(new Date(phase.start))}
          </p>
          {phase.meetLink ? (
            <Button asChild className="w-fit">
              <a href={phase.meetLink}>Join Google Meet</a>
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">
            A short email with the Meet link and a way to cancel is on its way. Google will also
            send the calendar invite.
          </p>
        </div>
      </Frame>
    );
  }

  const preview = phase.preview;

  return (
    <Frame>
      <div className="grid grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 border-border p-6 lg:border-r">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">{preview.hostName}</p>
            <h1 className="font-display text-xl text-foreground">{preview.name}</h1>
          </div>
          <p className="text-sm text-foreground">{preview.durationMinutes} min · Google Meet</p>
          {preview.description ? (
            <p className="text-sm text-muted-foreground">{preview.description}</p>
          ) : null}
          <label className="mt-auto flex flex-col gap-1 pt-4">
            <span className="font-display text-sm text-foreground">Timezone</span>
            <Select
              value={zone}
              onValueChange={(value) => {
                setZone(value);
                setCursor(null);
                setDayKey(null);
                setStart(null);
              }}
            >
              <SelectTrigger aria-label="Your timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </aside>
        {preview.paused ? (
          <div className="flex items-center p-8">
            <p className="text-sm text-foreground">This link is paused.</p>
          </div>
        ) : byDay.size === 0 ? (
          <div className="flex items-center p-8">
            <p className="text-sm text-muted-foreground">No open times in this range.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_13.5rem]">
            <div className="flex flex-col gap-3 p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base text-foreground">{monthTitle(view)}</h2>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Previous month"
                    onClick={() => {
                      setCursor(shiftMonth(view, -1));
                      setDayKey(null);
                      setStart(null);
                    }}
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Next month"
                    onClick={() => {
                      setCursor(shiftMonth(view, 1));
                      setDayKey(null);
                      setStart(null);
                    }}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_HEAD.map((label) => (
                  <div
                    key={label}
                    className="py-1 text-center font-sans text-2xs text-muted-foreground"
                  >
                    {label}
                  </div>
                ))}
                {cells.map((cell) => {
                  const key = cellKey(cell);
                  const open = cell.inMonth && byDay.has(key);
                  const selected = key === activeKey && cell.inMonth;
                  return (
                    <button
                      key={`${key}-${cell.inMonth ? "in" : "out"}`}
                      type="button"
                      disabled={!open}
                      aria-label={open ? dayTitle(key, zone) : undefined}
                      aria-pressed={selected}
                      onClick={() => {
                        setDayKey(key);
                        setStart(null);
                      }}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-md font-sans text-sm tabular-nums",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        !cell.inMonth && "text-transparent",
                        cell.inMonth && !open && "text-muted-foreground",
                        open && "text-foreground hover:bg-accent",
                        selected && "bg-[var(--selected-bg)] text-foreground",
                      )}
                    >
                      {cell.inMonth ? cell.d : ""}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto border-border p-4 sm:border-l">
              {start ? (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void book();
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-muted-foreground">
                      {dayTitle(zoneKey(new Date(start), zone), zone)}
                    </p>
                    <p className="font-sans text-sm text-foreground tabular-nums">
                      {timeLabel(start, zone)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start px-0"
                    onClick={() => setStart(null)}
                  >
                    Choose another time
                  </Button>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm">Name</span>
                    <Input value={name} required onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm">Email</span>
                    <Input
                      type="email"
                      value={email}
                      required
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  {preview.noteEnabled ? (
                    <label className="flex flex-col gap-1">
                      <span className="font-display text-sm">Note</span>
                      <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                  ) : null}
                  {(preview.questions ?? []).map((question) =>
                    question.id && question.label ? (
                      <label key={question.id} className="flex flex-col gap-1">
                        <span className="font-display text-sm">{question.label}</span>
                        <Input
                          required={question.required === true}
                          value={answers[question.id] ?? ""}
                          onChange={(e) =>
                            setAnswers((current) => ({
                              ...current,
                              [question.id as string]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ) : null,
                  )}
                  {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Booking…" : "Confirm"}
                  </Button>
                </form>
              ) : (
                <>
                  <h2 className="font-display text-sm text-foreground">
                    {activeKey ? dayTitle(activeKey, zone) : "No times this month"}
                  </h2>
                  {times.map((slot) => (
                    <Button
                      key={slot}
                      type="button"
                      variant="outline"
                      className="w-full tabular-nums"
                      onClick={() => setStart(slot)}
                    >
                      {timeLabel(slot, zone)}
                    </Button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}
