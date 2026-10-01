/**
 * Public booking page (/book/$slug). No account. The guest picks an open time
 * and sends the form the host configured. Confirming creates the Meet event.
 */

import { useParams } from "@tanstack/react-router";
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

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; preview: BookingPreview }
  | { kind: "booked"; start: string; meetLink: string };

function detectedZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return GUEST_ZONES.includes(zone) ? zone : zone;
}

export function BookPage() {
  const { slug } = useParams({ from: "/book/$slug" });
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [zone, setZone] = useState(detectedZone);
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

  const days = useMemo(() => {
    if (phase.kind !== "ready") return [];
    const groups = new Map<string, string[]>();
    for (const slot of phase.preview.slots) {
      const label = new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date(slot));
      const list = groups.get(label) ?? [];
      list.push(slot);
      groups.set(label, list);
    }
    return [...groups.entries()];
  }, [phase, zone]);

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

  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-4 bg-background px-6 py-10 text-foreground">
      {phase.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading times…</p>
      ) : null}
      {phase.kind === "missing" ? (
        <p className="text-sm text-foreground">This booking link is not available.</p>
      ) : null}
      {phase.kind === "error" ? (
        <p className="text-sm text-foreground">Could not load open times.</p>
      ) : null}
      {phase.kind === "booked" ? (
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-xl text-foreground">You're booked</h1>
          <p className="text-sm text-foreground">
            {new Intl.DateTimeFormat(undefined, {
              timeZone: zone,
              dateStyle: "full",
              timeStyle: "short",
            }).format(new Date(phase.start))}
          </p>
          {phase.meetLink ? (
            <a href={phase.meetLink} className="text-sm text-foreground underline">
              Join Google Meet
            </a>
          ) : null}
          <p className="text-sm text-muted-foreground">
            A short email with the Meet link and a way to cancel is on its way. Google will also
            send the calendar invite.
          </p>
        </div>
      ) : null}
      {phase.kind === "ready" ? (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">{phase.preview.hostName}</p>
            <h1 className="font-display text-xl text-foreground">{phase.preview.name}</h1>
            {phase.preview.description ? (
              <p className="text-sm text-muted-foreground">{phase.preview.description}</p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {phase.preview.durationMinutes} min · Google Meet
            </p>
          </div>
          {phase.preview.paused ? (
            <p className="text-sm text-foreground">This link is paused.</p>
          ) : (
            <>
              <Select value={zone} onValueChange={setZone}>
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
              {days.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open times in this range.</p>
              ) : (
                days.map(([label, slots]) => (
                  <div key={label} className="flex flex-col gap-2">
                    <h2 className="font-display text-sm text-foreground">{label}</h2>
                    <div className="flex flex-wrap gap-2">
                      {slots.map((slot) => (
                        <Button
                          key={slot}
                          type="button"
                          size="sm"
                          variant={start === slot ? "secondary" : "outline"}
                          onClick={() => setStart(slot)}
                        >
                          {new Intl.DateTimeFormat(undefined, {
                            timeZone: zone,
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(slot))}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))
              )}
              {start ? (
                <form
                  className="flex flex-col gap-3 border-t border-border pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void book();
                  }}
                >
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
                  {phase.preview.noteEnabled ? (
                    <label className="flex flex-col gap-1">
                      <span className="font-display text-sm">Note</span>
                      <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                  ) : null}
                  {(phase.preview.questions ?? []).map((question) =>
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
                    Confirm booking
                  </Button>
                </form>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
