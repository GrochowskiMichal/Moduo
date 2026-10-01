/**
 * Public booking page (/book/$slug). No account. The guest picks a day, then
 * a time, then confirms. On a phone those are three full-width steps. On a
 * wide screen the day and the times sit side by side.
 */

import { useParams } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Clock, Video } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
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
import { MAX_BOOKING_GUESTS, parseGuestEmails } from "../../features/calendar/booking/guests";
import {
  type BookingPreview,
  bookingRequest,
  GUEST_ZONES,
} from "../../features/calendar/booking/public-client";
import { bookingPublicOrigin } from "../../features/calendar/booking/public-origin";
import { cn } from "../../lib/utils";

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; preview: BookingPreview }
  | { kind: "booked"; start: string; meetLink: string; guests: string[] };

type Ymd = { y: number; m: number; d: number };

const WEEKDAY_HEAD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function detectedZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return GUEST_ZONES.includes(zone) ? zone : zone;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

function zoneLabel(zone: string): string {
  const place = (zone.split("/").pop() ?? zone).replace(/_/g, " ");
  try {
    const clock = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
    return `${place} (${clock})`;
  } catch {
    return place;
  }
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

function whenLabel(slot: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(slot));
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh justify-center bg-background text-foreground sm:px-6 lg:items-center lg:py-8">
      <div className="flex w-full max-w-6xl flex-col bg-card sm:rounded-lg sm:border sm:border-border lg:h-[calc(100dvh-4rem)] lg:overflow-hidden">
        {children}
      </div>
    </main>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-display text-sm text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function BookPage() {
  const { slug } = useParams({ from: "/book/$slug" });
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [zone, setZone] = useState(detectedZone);
  const [cursor, setCursor] = useState<Ymd | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [showTimes, setShowTimes] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [guests, setGuests] = useState<{ id: string; email: string }[]>([]);
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
  const todayKey = zoneKey(new Date(), zone);

  const book = async () => {
    if (phase.kind !== "ready" || !start) return;
    setSubmitting(true);
    setFormError(null);
    const questions = phase.preview.questions ?? [];
    const invited = phase.preview.guestsEnabled
      ? parseGuestEmails(
          guests.map((guest) => guest.email),
          email,
        )
      : { ok: true as const, emails: [] as string[] };
    if (!invited.ok) {
      setSubmitting(false);
      setFormError("Each guest needs their own email address, up to 10.");
      return;
    }
    const res = await bookingRequest({
      action: "book",
      slug,
      start,
      timeZone: zone,
      name,
      email,
      note,
      guests: invited.emails,
      origin: bookingPublicOrigin(window.location),
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
          : res.json.error === "bad_guest"
            ? "Each guest needs their own email address, up to 10."
            : "Could not book that time. Try again.",
      );
      if (res.json.error === "slot_taken") setStart(null);
      return;
    }
    setPhase({
      kind: "booked",
      start: String(res.json.start ?? start),
      meetLink: String(res.json.meetLink ?? ""),
      guests: invited.emails,
    });
  };

  if (phase.kind === "loading") {
    return (
      <Frame>
        <div className="flex flex-col gap-4 p-6 sm:p-10">
          <div className="size-16 rounded-full bg-muted" />
          <div className="h-8 w-56 rounded-md bg-muted" />
          <div className="h-4 w-40 rounded-md bg-muted" />
          <div className="mt-6 h-64 rounded-lg bg-muted" />
        </div>
      </Frame>
    );
  }

  if (phase.kind === "missing" || phase.kind === "error") {
    return (
      <Frame>
        <div className="flex flex-col gap-3 p-6 sm:p-10">
          <h1 className="font-display text-3xl text-foreground">
            {phase.kind === "missing" ? "This link is not available" : "Could not load times"}
          </h1>
          <p className="text-base text-muted-foreground">
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
        <div className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6 sm:p-10">
          <h1 className="font-display text-3xl text-foreground">You're booked</h1>
          <p className="font-sans text-lg text-foreground tabular-nums">
            {whenLabel(phase.start, zone)}
          </p>
          {phase.meetLink ? (
            <Button asChild size="lg" className="w-full sm:w-fit">
              <a href={phase.meetLink}>Join Google Meet</a>
            </Button>
          ) : null}
          <p className="text-base text-muted-foreground">
            A short email with the Meet link and a way to cancel is on its way. Google will also
            send the calendar invite.
          </p>
          {phase.guests.length > 0 ? (
            <p className="text-base text-foreground">Also invited: {phase.guests.join(", ")}.</p>
          ) : null}
        </div>
      </Frame>
    );
  }

  const preview = phase.preview;
  const picking = !preview.paused && byDay.size > 0 && !start;
  const onPhoneTimes = showTimes && !start;

  return (
    <Frame>
      <div
        className={cn(
          "flex flex-1 flex-col lg:grid lg:min-h-0",
          picking
            ? "lg:grid-cols-[22rem_minmax(0,1fr)_20rem]"
            : "lg:grid-cols-[22rem_minmax(0,1fr)]",
        )}
      >
        <aside
          className={cn(
            "flex flex-col gap-6 border-border p-6 sm:p-8 lg:overflow-y-auto lg:border-r",
            (onPhoneTimes || start) && "max-lg:hidden",
          )}
        >
          <div className="flex items-center gap-4">
            <Avatar className="size-16">
              {preview.hostAvatarUrl ? <AvatarImage src={preview.hostAvatarUrl} alt="" /> : null}
              <AvatarFallback className="text-lg">{initials(preview.hostName)}</AvatarFallback>
            </Avatar>
            <p className="min-w-0 font-sans text-md text-foreground">{preview.hostName}</p>
          </div>
          <h1 className="font-display text-3xl text-balance text-foreground">{preview.name}</h1>
          <div className="flex flex-col gap-2 font-sans text-base text-foreground">
            <p className="flex items-center gap-2">
              <Clock className="size-icon text-muted-foreground" aria-hidden />
              {preview.durationMinutes} min
            </p>
            <p className="flex items-center gap-2">
              <Video className="size-icon text-muted-foreground" aria-hidden />
              Google Meet
            </p>
          </div>
          {preview.description ? (
            <p className="whitespace-pre-wrap font-sans text-base text-muted-foreground">
              {preview.description}
            </p>
          ) : null}
          <Field id="book-timezone" label="Timezone">
            <Select
              value={zone}
              onValueChange={(value) => {
                setZone(value);
                setCursor(null);
                setDayKey(null);
                setShowTimes(false);
                setStart(null);
              }}
            >
              <SelectTrigger id="book-timezone" aria-label="Your timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((item) => (
                  <SelectItem key={item} value={item}>
                    {zoneLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </aside>

        {preview.paused || byDay.size === 0 ? (
          <div className="flex flex-1 items-center p-6 sm:p-10">
            <p className="font-sans text-base text-foreground">
              {preview.paused ? "This link is paused." : "No open times in this range."}
            </p>
          </div>
        ) : (
          <>
            <div
              className={cn("flex flex-col gap-4 p-6 sm:p-8", (onPhoneTimes || start) && "hidden")}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-xl text-foreground">{monthTitle(view)}</h2>
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
                    className="py-1 text-center font-sans text-xs text-muted-foreground"
                  >
                    {label}
                  </div>
                ))}
                {cells.map((cell) => {
                  const key = cellKey(cell);
                  const open = cell.inMonth && byDay.has(key);
                  const selected = key === activeKey && cell.inMonth;
                  const today = key === todayKey && cell.inMonth;
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
                        setShowTimes(true);
                      }}
                      className={cn(
                        "flex aspect-square w-full items-center justify-center rounded-md font-sans text-base tabular-nums",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        !cell.inMonth && "text-transparent",
                        cell.inMonth && !open && "text-muted-foreground",
                        open && !selected && "font-medium text-foreground hover:bg-accent",
                        today && !selected && "ring-1 ring-border",
                        selected && "bg-[var(--selected-bg)] font-medium text-foreground",
                      )}
                    >
                      {cell.inMonth ? cell.d : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className={cn(
                "flex min-h-0 flex-col gap-3 p-6 sm:p-8",
                start && "hidden",
                !showTimes && "max-lg:hidden",
              )}
            >
              <Button
                type="button"
                variant="ghost"
                className="w-fit justify-start px-0 lg:hidden"
                onClick={() => setShowTimes(false)}
              >
                <ChevronLeft aria-hidden />
                Calendar
              </Button>
              <h2 className="font-display text-xl text-foreground">
                {activeKey ? dayTitle(activeKey, zone) : "No times this month"}
              </h2>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {times.map((slot) => (
                  <Button
                    key={slot}
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full tabular-nums"
                    onClick={() => setStart(slot)}
                  >
                    {timeLabel(slot, zone)}
                  </Button>
                ))}
              </div>
            </div>

            {start ? (
              <form
                className="flex min-h-0 flex-col gap-5 overflow-y-auto p-6 sm:p-8"
                onSubmit={(e) => {
                  e.preventDefault();
                  void book();
                }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="w-fit justify-start px-0"
                  onClick={() => setStart(null)}
                >
                  <ChevronLeft aria-hidden />
                  Choose another time
                </Button>
                <div className="flex flex-col gap-1">
                  <p className="font-sans text-lg text-foreground tabular-nums">
                    {timeLabel(start, zone)}
                  </p>
                  <p className="font-sans text-base text-muted-foreground">
                    {dayTitle(zoneKey(new Date(start), zone), zone)} · {preview.durationMinutes} min
                  </p>
                </div>
                <Field id="book-name" label="Name">
                  <Input
                    id="book-name"
                    value={name}
                    required
                    autoComplete="name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field id="book-email" label="Email">
                  <Input
                    id="book-email"
                    type="email"
                    value={email}
                    required
                    autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                {preview.guestsEnabled ? (
                  <div className="flex flex-col gap-2">
                    {guests.length > 0 ? (
                      <p className="font-display text-sm text-foreground">Guests</p>
                    ) : null}
                    {guests.map((guest, index) => (
                      <div key={guest.id} className="flex items-center gap-2">
                        <Input
                          type="email"
                          value={guest.email}
                          placeholder="name@email.com"
                          aria-label={`Guest ${index + 1} email`}
                          autoComplete="off"
                          onChange={(e) =>
                            setGuests((current) =>
                              current.map((item) =>
                                item.id === guest.id ? { ...item, email: e.target.value } : item,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            setGuests((current) => current.filter((item) => item.id !== guest.id))
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    {guests.length < MAX_BOOKING_GUESTS ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-fit justify-start px-0"
                        onClick={() =>
                          setGuests((current) => [
                            ...current,
                            { id: crypto.randomUUID(), email: "" },
                          ])
                        }
                      >
                        {guests.length === 0 ? "Add guests" : "Add another guest"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {preview.noteEnabled ? (
                  <Field id="book-note" label="Note">
                    <Textarea
                      id="book-note"
                      value={note}
                      rows={4}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                ) : null}
                {(preview.questions ?? []).map((question) =>
                  question.id && question.label ? (
                    <Field key={question.id} id={`book-q-${question.id}`} label={question.label}>
                      <Input
                        id={`book-q-${question.id}`}
                        required={question.required === true}
                        value={answers[question.id] ?? ""}
                        onChange={(e) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id as string]: e.target.value,
                          }))
                        }
                      />
                    </Field>
                  ) : null,
                )}
                {formError ? (
                  <p role="alert" className="text-base text-destructive">
                    {formError}
                  </p>
                ) : null}
                <Button type="submit" size="lg" className="w-full sm:w-fit" disabled={submitting}>
                  {submitting ? "Booking…" : "Schedule meeting"}
                </Button>
              </form>
            ) : null}
          </>
        )}
      </div>
    </Frame>
  );
}
