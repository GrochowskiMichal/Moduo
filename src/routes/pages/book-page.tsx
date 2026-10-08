/**
 * Public booking page (/book/$slug). No account.
 *
 * The page is one sentence the guest finishes: "Let's talk for 30 minutes on
 * [day] at [time] [Warsaw time]. I'm [name], and you can reach me at [email]."
 * Each choice blank opens a tray of options under the sentence. The book
 * button always says what is still missing and jumps there when pressed.
 */

import { useParams } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Eyebrow } from "../../components/ui/eyebrow";
import { Input } from "../../components/ui/input";
import { ModuoMark } from "../../components/ui/moduo-mark";
import { Textarea } from "../../components/ui/textarea";
import {
  isEmailAddress,
  MAX_BOOKING_GUESTS,
  parseGuestEmails,
} from "../../features/calendar/booking/guests";
import {
  type BookingPreview,
  bookingRequest,
  GUEST_ZONES,
} from "../../features/calendar/booking/public-client";
import { bookingPublicOrigin } from "../../features/calendar/booking/public-origin";
import {
  type DayPart,
  daysBetween,
  durationPhrase,
  firstName,
  groupByDay,
  groupByPart,
  quickPicks,
  zoneKey,
  zonePlace,
} from "../../features/calendar/booking/sentence";
import {
  Blank,
  BlankInput,
  Chip,
  clockIn,
  DayStrip,
  dayLong,
  dayShort,
  Fixed,
  Tray,
  timeLabel,
} from "../../features/calendar/booking/sentence-ui";
import { VIDEO_LABEL, type VideoProvider } from "../../features/calendar/booking/video";
import { cn } from "../../lib/utils";

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; preview: BookingPreview }
  | {
      kind: "booked";
      preview: BookingPreview;
      start: string;
      meetLink: string;
      video: VideoProvider;
      guests: string[];
    };

type TrayKind = "video" | "day" | "time" | "zone";

const VIDEO_HINT: Record<VideoProvider, string> = {
  google_meet: "Joins in the browser",
  zoom: "Opens in the Zoom app",
};

const PART_LABEL: Record<DayPart, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

function detectedZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

function relativeDay(key: string, todayKey: string): string {
  const diff = daysBetween(todayKey, key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
      new Date(`${key}T12:00:00Z`),
    );
  }
  return dayShort(key);
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 pt-8 pb-6 sm:gap-10 sm:px-10 sm:pt-16 lg:pt-24">
        {children}
      </div>
      <footer className="mx-auto w-full max-w-4xl px-4 pb-8 sm:px-10">
        <a
          href="https://moduo.app"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-2 font-sans text-sm text-muted-foreground hover:text-foreground"
        >
          <ModuoMark aria-hidden small className="size-icon-sm text-current" />
          Scheduled with Moduo
        </a>
      </footer>
    </main>
  );
}

/** The big type every sentence on this page is set in. */
const SENTENCE =
  "max-w-4xl font-sans text-3xl leading-snug font-light tracking-tight text-pretty text-foreground sm:text-4xl lg:text-5xl";

function Host({ preview }: { preview: BookingPreview }) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar className="size-10">
          {preview.hostAvatarUrl ? <AvatarImage src={preview.hostAvatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(preview.hostName)}</AvatarFallback>
        </Avatar>
        <h1 className="min-w-0 font-display text-md text-foreground">
          {preview.name}
          <span className="text-muted-foreground"> with {preview.hostName}</span>
        </h1>
      </div>
      {preview.description ? (
        <p className="max-w-prose font-sans text-base whitespace-pre-wrap text-muted-foreground">
          {preview.description}
        </p>
      ) : null}
    </header>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <p className={SENTENCE}>{title}</p>
      <p className="max-w-prose font-sans text-md text-muted-foreground">{body}</p>
      {action}
    </section>
  );
}

export function BookPage() {
  const { slug } = useParams({ from: "/book/$slug" });
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [zone, setZone] = useState(detectedZone);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [tray, setTray] = useState<TrayKind | null>("day");
  const [video, setVideo] = useState<VideoProvider | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [guests, setGuests] = useState<{ id: string; email: string }[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const dayBlank = useRef<HTMLButtonElement>(null);
  const timeBlank = useRef<HTMLButtonElement>(null);
  const zoneBlank = useRef<HTMLButtonElement>(null);
  const videoBlank = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const focusTrayOnOpen = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on "Try again".
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
        // "Their choice": the guest picks the platform first.
        if ((preview.videoOptions?.length ?? 0) > 1) setTray("video");
      } catch {
        if (active) setPhase({ kind: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [slug, attempt]);

  const preview = phase.kind === "ready" || phase.kind === "booked" ? phase.preview : null;
  const slots = preview?.slots ?? [];
  const byDay = useMemo(() => groupByDay(slots, zone), [slots, zone]);
  const picks = useMemo(() => quickPicks(slots, zone), [slots, zone]);
  const zones = useMemo(
    () => (GUEST_ZONES.includes(zone) ? GUEST_ZONES : [zone, ...GUEST_ZONES]),
    [zone],
  );
  const todayKey = zoneKey(new Date(), zone);
  const activeDay = start ? zoneKey(new Date(start), zone) : dayKey;
  const dayTimes = activeDay ? (byDay.get(activeDay) ?? []) : [];

  // Move focus into a tray the guest opened by picking (not by clicking its blank).
  useEffect(() => {
    if (!tray || !focusTrayOnOpen.current) return;
    focusTrayOnOpen.current = false;
    trayRef.current
      ?.querySelector<HTMLElement>("[aria-pressed='true'], [data-first]")
      ?.focus({ preventScroll: true });
  }, [tray]);

  if (phase.kind === "loading") {
    return (
      <Page>
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-muted" />
          <div className="h-4 w-48 rounded-md bg-muted" />
        </div>
        <div className="flex flex-col gap-4" aria-label="Loading open times" role="status">
          <div className="h-10 w-full max-w-2xl rounded-md bg-muted sm:h-12" />
          <div className="h-10 w-3/4 max-w-xl rounded-md bg-muted sm:h-12" />
          <div className="mt-4 h-32 rounded-lg bg-muted" />
        </div>
      </Page>
    );
  }

  if (phase.kind === "missing") {
    return (
      <Page>
        <Notice
          title="This booking link isn't available."
          body="It may have been turned off or replaced. Ask the person who sent it for a new link."
        />
      </Page>
    );
  }

  if (phase.kind === "error") {
    return (
      <Page>
        <Notice
          title="We couldn't load the open times."
          body="Check your connection and try again."
          action={
            <Button
              type="button"
              size="lg"
              className="w-fit"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </Button>
          }
        />
      </Page>
    );
  }

  if (!preview) return null;
  const host = firstName(preview.hostName);
  const videoChoices: VideoProvider[] =
    preview.videoOptions && preview.videoOptions.length > 0
      ? preview.videoOptions
      : [preview.video ?? "google_meet"];
  const guestPicks = videoChoices.length > 1;
  // On a "their choice" link nothing is picked until the guest picks.
  const chosen: VideoProvider | null =
    video && videoChoices.includes(video) ? video : guestPicks ? null : (videoChoices[0] ?? null);
  const platform: VideoProvider = chosen ?? videoChoices[0] ?? "google_meet";
  const platformPhrase = guestPicks
    ? videoChoices.map((choice) => VIDEO_LABEL[choice]).join(" or ")
    : VIDEO_LABEL[platform];
  const echo = (slot: string) =>
    zone === preview.hostTimeZone
      ? null
      : `That's ${timeLabel(slot, preview.hostTimeZone)} for ${host} in ${zonePlace(preview.hostTimeZone)}.`;

  if (phase.kind === "booked") {
    const key = zoneKey(new Date(phase.start), zone);
    return (
      <Page>
        <Host preview={preview} />
        <section className="flex animate-in flex-col gap-6 fade-in-0 duration-[var(--motion-slow)]">
          <p className={SENTENCE} role="status">
            You're meeting {host} on <Fixed>{dayLong(key)}</Fixed> at{" "}
            <Fixed>{timeLabel(phase.start, zone)}</Fixed>.
          </p>
          <div className="flex max-w-prose flex-col gap-2 font-sans text-md text-muted-foreground">
            <p>
              {durationPhrase(preview.durationMinutes)} on {VIDEO_LABEL[phase.video]}. A calendar
              invite and a short email with a way to cancel are on their way to {email.trim()}.
            </p>
            {echo(phase.start) ? <p>{echo(phase.start)}</p> : null}
            {phase.guests.length > 0 ? <p>Also invited: {phase.guests.join(", ")}.</p> : null}
          </div>
          {phase.meetLink ? (
            <Button asChild size="lg" className="w-full sm:w-fit">
              <a href={phase.meetLink} target="_blank" rel="noopener">
                Join {VIDEO_LABEL[phase.video]}
              </a>
            </Button>
          ) : null}
        </section>
      </Page>
    );
  }

  if (preview.paused || slots.length === 0) {
    return (
      <Page>
        <Host preview={preview} />
        <Notice
          title={
            preview.paused
              ? `${host} isn't taking bookings on this link right now.`
              : `${host} has no open times in the next few weeks.`
          }
          body={
            preview.paused
              ? "Try again later, or reach out to them directly."
              : "New times open up as the calendar changes. Check back soon."
          }
        />
      </Page>
    );
  }

  const questions = (preview.questions ?? []).filter((question) => question.id && question.label);
  const unanswered = questions.find(
    (question) => question.required === true && !(answers[question.id as string] ?? "").trim(),
  );
  const nameOk = name.trim().length > 0;
  // Same check as the server, which uses this address as the email recipient.
  const emailOk = isEmailAddress(email.trim());

  const openTray = (next: TrayKind | null, focusInside = false) => {
    focusTrayOnOpen.current = focusInside;
    setTray(next);
  };
  const toggle = (kind: TrayKind) => openTray(tray === kind ? null : kind);
  const closeTray = () => {
    const back =
      tray === "day"
        ? dayBlank
        : tray === "time"
          ? timeBlank
          : tray === "video"
            ? videoBlank
            : zoneBlank;
    setTray(null);
    back.current?.focus();
  };

  const pickDay = (key: string) => {
    setDayKey(key);
    setStart(null);
    setFormError(null);
    openTray("time", true);
  };

  const pickSlot = (slot: string) => {
    setStart(slot);
    setDayKey(zoneKey(new Date(slot), zone));
    setFormError(null);
    setTray(null);
    requestAnimationFrame(() => {
      if (!nameOk) nameInput.current?.focus();
      else if (!emailOk) emailInput.current?.focus();
    });
  };

  const pickVideo = (next: VideoProvider) => {
    setVideo(next);
    setFormError(null);
    openTray(activeDay ? null : "day", !activeDay);
    if (activeDay) videoBlank.current?.focus();
  };

  const pickZone = (next: string) => {
    setZone(next);
    if (!start) setDayKey(null);
    setTray(null);
    zoneBlank.current?.focus();
  };

  // What the book button does next: the first missing thing, or book.
  const nextStep: { label: string; go: () => void } | null = !chosen
    ? { label: `Pick ${platformPhrase}`, go: () => openTray("video", true) }
    : !activeDay
      ? { label: "Pick a day", go: () => openTray("day", true) }
      : !start
        ? { label: "Pick a time", go: () => openTray("time", true) }
        : !nameOk
          ? { label: "Add your name", go: () => nameInput.current?.focus() }
          : !emailOk
            ? { label: "Add your email", go: () => emailInput.current?.focus() }
            : unanswered
              ? {
                  label: `Answer ${host}'s question`,
                  go: () => document.getElementById(`book-q-${unanswered.id}`)?.focus(),
                }
              : null;

  const bookErrorMessage = (code: unknown): string => {
    switch (code) {
      case "bad_guest":
        return "Each guest needs their own email address, up to 10.";
      case "zoom_failed":
        return videoChoices.length > 1
          ? "Zoom couldn't create the meeting. Try again, or pick Google Meet."
          : "Zoom couldn't create the meeting. Try again in a moment.";
      case "host_unavailable":
        return `${host}'s calendar isn't connected right now. Try again later.`;
      case "paused":
        return `${host} isn't taking bookings on this link right now.`;
      case "rate_limited":
        return "Too many booking attempts from this network. Try again in an hour.";
      case "host_busy":
        return `${host} is getting a lot of booking requests right now. Try again in an hour.`;
      default:
        return "Couldn't book that time. Try again.";
    }
  };

  const book = async () => {
    if (!start) return;
    setSubmitting(true);
    setFormError(null);
    const invited = preview.guestsEnabled
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
    let res: Awaited<ReturnType<typeof bookingRequest>>;
    try {
      res = await bookingRequest({
        action: "book",
        slug,
        start,
        timeZone: zone,
        name: name.trim(),
        email: email.trim(),
        note: noteOpen ? note : "",
        guests: invited.emails,
        video: platform,
        origin: bookingPublicOrigin(window.location),
        answers: questions.map((question) => ({
          id: question.id,
          value: answers[question.id as string] ?? "",
        })),
      });
    } catch {
      setSubmitting(false);
      setFormError("Couldn't reach the server. Check your connection and try again.");
      return;
    }
    setSubmitting(false);
    if (!res.ok) {
      if (res.json.error === "slot_taken") {
        const taken = start;
        setPhase({
          kind: "ready",
          preview: { ...preview, slots: preview.slots.filter((slot) => slot !== taken) },
        });
        setStart(null);
        setFormError(`Someone just took ${timeLabel(taken, zone)}. Pick another time.`);
        openTray("time", true);
        return;
      }
      setFormError(bookErrorMessage(res.json.error));
      return;
    }
    setPhase({
      kind: "booked",
      preview,
      start: String(res.json.start ?? start),
      meetLink: String(res.json.meetLink ?? ""),
      video:
        res.json.video === "zoom" || res.json.video === "google_meet" ? res.json.video : platform,
      guests: invited.emails,
    });
    window.scrollTo({ top: 0 });
  };

  const addGuest = () => {
    const id = crypto.randomUUID();
    setGuests((current) => [...current, { id, email: "" }]);
    requestAnimationFrame(() => document.getElementById(`book-guest-${id}`)?.focus());
  };

  const days = [...byDay.entries()].map(([key, list]) => ({ key, count: list.length }));

  return (
    <Page>
      <Host preview={preview} />

      <form
        noValidate
        className="flex flex-1 flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (nextStep) nextStep.go();
          else void book();
        }}
      >
        <p className={SENTENCE}>
          Let's talk over{" "}
          {videoChoices.length > 1 ? (
            <Blank
              ref={videoBlank}
              label="Video call on"
              value={chosen ? VIDEO_LABEL[chosen] : null}
              placeholder={platformPhrase}
              open={tray === "video"}
              controls="book-tray"
              onToggle={() => toggle("video")}
            />
          ) : (
            <Fixed>{VIDEO_LABEL[platform]}</Fixed>
          )}{" "}
          for <Fixed>{durationPhrase(preview.durationMinutes)}</Fixed> on{" "}
          <Blank
            ref={dayBlank}
            label="Day"
            value={activeDay ? dayLong(activeDay) : null}
            placeholder="which day"
            open={tray === "day"}
            controls="book-tray"
            onToggle={() => toggle("day")}
          />{" "}
          at{" "}
          <Blank
            ref={timeBlank}
            label="Time"
            value={start ? timeLabel(start, zone) : null}
            placeholder="what time"
            open={tray === "time"}
            disabled={!activeDay}
            controls="book-tray"
            onToggle={() => toggle("time")}
          />{" "}
          <Blank
            ref={zoneBlank}
            label="Timezone"
            value={`${zonePlace(zone)} time`}
            placeholder=""
            open={tray === "zone"}
            controls="book-tray"
            onToggle={() => toggle("zone")}
          />
          .
        </p>

        {tray ? (
          <div ref={trayRef}>
            {tray === "video" ? (
              <Tray
                id="book-tray"
                label="Choose how to meet"
                heading="Choose how to meet"
                aside={`${host} can do either`}
                onClose={closeTray}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {videoChoices.map((choice, index) => (
                    <button
                      key={choice}
                      type="button"
                      aria-pressed={choice === chosen}
                      data-first={index === 0 ? "" : undefined}
                      onClick={() => pickVideo(choice)}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left",
                        "transition-colors duration-[var(--motion-fade)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        choice === chosen
                          ? "border-[var(--selected-border)] bg-[var(--selected-bg)]"
                          : "border-border hover:border-foreground",
                      )}
                    >
                      <span className="font-sans text-xl text-foreground">
                        {VIDEO_LABEL[choice]}
                      </span>
                      <span className="font-sans text-sm text-muted-foreground">
                        {VIDEO_HINT[choice]}
                      </span>
                    </button>
                  ))}
                </div>
              </Tray>
            ) : null}

            {tray === "day" ? (
              <Tray
                id="book-tray"
                label="Choose a day"
                heading="Choose a day"
                aside={`${days.length} open ${days.length === 1 ? "day" : "days"}`}
                onClose={closeTray}
              >
                {picks.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <Eyebrow as="p">Soonest</Eyebrow>
                    <div className="flex flex-wrap gap-2">
                      {picks.map((slot, index) => (
                        <Chip
                          key={slot}
                          data-first={index === 0 ? "" : undefined}
                          aria-label={`${dayLong(zoneKey(new Date(slot), zone))} at ${timeLabel(slot, zone)}`}
                          onClick={() => pickSlot(slot)}
                        >
                          <span className="text-muted-foreground">
                            {relativeDay(zoneKey(new Date(slot), zone), todayKey)}
                          </span>
                          {timeLabel(slot, zone)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Eyebrow as="p">Every open day</Eyebrow>
                  <DayStrip days={days} selected={activeDay} onPick={pickDay} />
                </div>
              </Tray>
            ) : null}

            {tray === "time" && activeDay ? (
              <Tray
                id="book-tray"
                label={`Times on ${dayLong(activeDay)}`}
                heading={dayLong(activeDay)}
                aside={
                  <button
                    type="button"
                    className="underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openTray("day", true)}
                  >
                    Another day
                  </button>
                }
                onClose={closeTray}
              >
                <div className="flex flex-col gap-3">
                  {groupByPart(dayTimes, zone).map((group, groupIndex) => (
                    <div
                      key={group.part}
                      className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-start"
                    >
                      <p className="font-sans text-sm text-muted-foreground sm:pt-2.5">
                        {PART_LABEL[group.part]}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.slots.map((slot, index) => (
                          <Chip
                            key={slot}
                            selected={slot === start}
                            data-first={groupIndex === 0 && index === 0 ? "" : undefined}
                            onClick={() => pickSlot(slot)}
                          >
                            {timeLabel(slot, zone)}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Tray>
            ) : null}

            {tray === "zone" ? (
              <Tray
                id="book-tray"
                label="Choose your timezone"
                heading="Show times in"
                aside="Your timezone was detected from this device."
                onClose={closeTray}
              >
                <div className="flex flex-wrap gap-2">
                  {zones.map((item) => (
                    <Chip key={item} selected={item === zone} onClick={() => pickZone(item)}>
                      {zonePlace(item)}
                      <span className="text-muted-foreground">{clockIn(item)}</span>
                    </Chip>
                  ))}
                </div>
              </Tray>
            ) : null}
          </div>
        ) : null}

        <p className={SENTENCE}>
          I'm{" "}
          <BlankInput
            ref={nameInput}
            id="book-name"
            label="Your name"
            placeholder="your name"
            autoComplete="name"
            enterKeyHint="next"
            value={name}
            aria-invalid={touched && !nameOk ? true : undefined}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                emailInput.current?.focus();
              }
            }}
          />
          , and you can reach me at{" "}
          <BlankInput
            ref={emailInput}
            id="book-email"
            type="email"
            inputMode="email"
            label="Your email"
            placeholder="you@email.com"
            autoComplete="email"
            enterKeyHint="go"
            value={email}
            aria-invalid={touched && !emailOk ? true : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          .
        </p>

        {preview.guestsEnabled && guests.length > 0 ? (
          <p className={SENTENCE}>
            I'm also bringing{" "}
            {guests.map((guest, index) => (
              <span key={guest.id}>
                {index === 0 ? "" : index === guests.length - 1 ? " and " : ", "}
                <span className="inline-flex items-baseline whitespace-nowrap">
                  <BlankInput
                    id={`book-guest-${guest.id}`}
                    type="email"
                    inputMode="email"
                    label={`Guest ${index + 1} email`}
                    placeholder="their@email.com"
                    autoComplete="off"
                    value={guest.email}
                    onChange={(event) =>
                      setGuests((current) =>
                        current.map((item) =>
                          item.id === guest.id ? { ...item, email: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  {index === guests.length - 1 ? "." : ""}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove guest ${index + 1}`}
                    className="mx-1 self-center text-muted-foreground"
                    onClick={() =>
                      setGuests((current) => current.filter((item) => item.id !== guest.id))
                    }
                  >
                    <X aria-hidden className="size-icon" />
                  </Button>
                </span>
              </span>
            ))}
          </p>
        ) : null}

        {questions.length > 0 ? (
          <section className="flex max-w-xl flex-col gap-5">
            <Eyebrow as="p">{host} also asks</Eyebrow>
            {questions.map((question) => (
              <div key={question.id} className="flex flex-col gap-2">
                <label
                  htmlFor={`book-q-${question.id}`}
                  className="font-display text-md text-foreground"
                >
                  {question.label}
                  {question.required ? null : (
                    <span className="text-muted-foreground"> (optional)</span>
                  )}
                </label>
                <Input
                  id={`book-q-${question.id}`}
                  value={answers[question.id as string] ?? ""}
                  aria-invalid={
                    touched &&
                    question.required === true &&
                    !(answers[question.id as string] ?? "").trim()
                      ? true
                      : undefined
                  }
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id as string]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </section>
        ) : null}

        {noteOpen ? (
          <div className="flex max-w-xl animate-in flex-col gap-2 fade-in-0 duration-[var(--motion-base)]">
            <label htmlFor="book-note" className="font-display text-md text-foreground">
              Anything {host} should know?
            </label>
            <Textarea
              id="book-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        ) : null}

        {(preview.guestsEnabled && guests.length < MAX_BOOKING_GUESTS) ||
        (preview.noteEnabled && !noteOpen) ? (
          <div className="-ml-2 flex flex-wrap gap-1">
            {preview.guestsEnabled && guests.length < MAX_BOOKING_GUESTS ? (
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={addGuest}
              >
                <Plus aria-hidden />
                {guests.length === 0 ? "Bring someone" : "Bring someone else"}
              </Button>
            ) : null}
            {preview.noteEnabled && !noteOpen ? (
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => {
                  setNoteOpen(true);
                  requestAnimationFrame(() => document.getElementById("book-note")?.focus());
                }}
              >
                <Plus aria-hidden />
                Add a note
              </Button>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn(
            "sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col gap-3 border-t border-border bg-background px-4 pt-4",
            "pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:px-0",
          )}
        >
          <Button type="submit" size="lg" className="w-full sm:w-fit" disabled={submitting}>
            {submitting
              ? "Booking…"
              : nextStep
                ? nextStep.label
                : `Book ${start ? `${dayShort(zoneKey(new Date(start), zone))} at ${timeLabel(start, zone)}` : ""}`}
          </Button>
          <div
            className="flex min-w-0 flex-col gap-1 font-sans text-sm text-muted-foreground"
            aria-live="polite"
          >
            {formError ? (
              <p role="alert" className="text-destructive">
                {formError}
              </p>
            ) : (
              <p>
                {start && echo(start) ? `${echo(start)} ` : ""}
                {chosen ? `${VIDEO_LABEL[chosen]} link` : "The video link"} arrives by email.
              </p>
            )}
          </div>
        </div>
      </form>
    </Page>
  );
}
