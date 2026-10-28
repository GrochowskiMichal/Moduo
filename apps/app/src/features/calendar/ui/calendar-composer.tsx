// The composer's host (CALR-9): N, ⌘N, the + button and ↵ on an empty slot
// open it at the grid cursor, else at the next free time. It reads the text
// (composer/parse.ts), decides where the event goes (composer/defaults.ts),
// draws the draft on the grid (composer/draft-store.ts), hops it with ⇥, and
// adds it through the page's create path, so the add has its Undo (AC21).
//
// Busy time is your own timed events (Moduo and your accounts'), not a
// teammate's shared calendar and not task blocks. People are your teammates
// (no email here yet: they're named, not invited) and your contacts with an
// email, read once per workspace when the box first opens.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { onCreateNew } from "../../../components/app/create-events";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { type ComposerAccount, planComposer } from "../composer/defaults";
import { setComposerDraft } from "../composer/draft-store";
import { clashFor, hopFreeTime, openingSlot } from "../composer/hops";
import {
  type ComposerBusy,
  type ComposerCalendar,
  type ComposerContext,
  type ComposerPerson,
  parseComposer,
} from "../composer/parse";
import { type CalendarEventModel, eventChipsInRange } from "../events";
import { freeForAll, verdictFor, verdictsEcho } from "../free-time";
import type { GridCursor } from "../grid-keys";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { chosenNewEventsTo, resolveNewEventsTo } from "../new-events-to";
import type { CalendarPrefs } from "../prefs";
import { EventComposer } from "./event-composer";
import { setTeammates, teammatesState, useTeammatesStore } from "./teammates-store";
import type { NewEventDraft } from "./use-create-event";

type Props = {
  calendar: CalendarModuleApi;
  runtime: ModuoRuntime | null;
  workspaceId: string;
  userId: string | null;
  prefs: CalendarPrefs;
  members: { userId: string; name: string }[];
  cursor: GridCursor | null;
  canEdit: boolean;
  createEvent: (draft: NewEventDraft) => void;
};

type Open = {
  base: ComposerContext["base"];
  text: string;
  /** A ⇥ hop, kept while the day and time words stay as they were. */
  hop: { whenKey: string; startMs: number; endMs: number } | null;
};

const BOX_WIDTH = 480;
const EDGE = 8;

/** Contacts with an email, per workspace, read once. */
const contactCache = new Map<string, Promise<ComposerPerson[]>>();

function loadContacts(runtime: ModuoRuntime, workspaceId: string): Promise<ComposerPerson[]> {
  let hit = contactCache.get(workspaceId);
  if (!hit) {
    hit = runtime.contacts
      .list(workspaceId)
      .then((bundle) =>
        bundle.contacts
          .filter((c) => c.email && c.name)
          .map((c) => ({ id: c.id, name: c.name, email: c.email, member: false })),
      )
      .catch(() => {
        contactCache.delete(workspaceId);
        return [];
      });
    contactCache.set(workspaceId, hit);
  }
  return hit;
}

function dayStartOfKey(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
}

/** Your timed busy time per day (expanded repeats), cached for one set of events. */
function busyReader(events: CalendarEventModel[], userId: string | null) {
  // Yours (your Moduo events and your accounts' mirrors), never a teammate's shared week.
  const mine = events.filter((e) => !e.allDay && e.ownerId === userId);
  const cache = new Map<number, ComposerBusy[]>();
  return (dayStartMs: number): ComposerBusy[] => {
    const hit = cache.get(dayStartMs);
    if (hit) return hit;
    const day = new Date(dayStartMs);
    const endMs = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const chips = eventChipsInRange(mine, {
      view: "day",
      days: [day],
      startMs: dayStartMs,
      endMs,
    }).timed;
    const busy = [...chips.values()]
      .flat()
      .map((c) => ({ startMs: c.startMs, endMs: c.endMs, title: c.title }));
    cache.set(dayStartMs, busy);
    return busy;
  };
}

function placeBox(box: HTMLElement | null): { left: number; top: number } {
  const ghost = document.querySelector<HTMLElement>("[data-composer-ghost]");
  const height = box?.offsetHeight ?? 160;
  const maxLeft = window.innerWidth - BOX_WIDTH - EDGE;
  if (!ghost) {
    return { left: Math.max(EDGE, (window.innerWidth - BOX_WIDTH) / 2), top: 96 };
  }
  const r = ghost.getBoundingClientRect();
  const below = r.bottom + EDGE;
  const top = below + height <= window.innerHeight - EDGE ? below : r.top - height - EDGE;
  return {
    left: Math.min(Math.max(EDGE, r.left), Math.max(EDGE, maxLeft)),
    top: Math.max(EDGE, top),
  };
}

export function CalendarComposer({
  calendar,
  runtime,
  workspaceId,
  userId,
  prefs,
  members,
  cursor,
  canEdit,
  createEvent,
}: Props) {
  const [open, setOpen] = useState<Open | null>(null);
  const [contacts, setContacts] = useState<ComposerPerson[]>([]);
  const [position, setPosition] = useState({ left: EDGE, top: 96 });
  const opener = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const busyOn = useMemo(() => busyReader(calendar.events, userId), [calendar.events, userId]);
  // CALR-16: teammates named in the box show their lanes, and ⇥ finds a time
  // every one of them is free; the clash that leads the echo stays your own.
  const blocks = useTeammatesStore((s) => s.blocks);
  const teammates = useTeammatesStore((s) => s.teammates);
  const newEventsTo = resolveNewEventsTo(
    chosenNewEventsTo(prefs, workspaceId),
    calendar.accounts,
  ).accountId;
  const accounts: ComposerAccount[] = useMemo(
    () =>
      calendar.accounts
        // Only calendars an event can be written to: not removed, not read-only,
        // not waiting on a reconnect (Google would refuse the write).
        .filter((a) => !a.deletedAt && !a.readOnly && a.status !== "reauth")
        .map((a) => ({
          id: a.id,
          provider: a.provider,
          externalId: a.externalId,
          label: a.displayLabel || "Google",
          // The "New events go to" calendar, from the synced setting (not the old column).
          isDefaultTarget: a.id === newEventsTo,
        })),
    [calendar.accounts, newEventsTo],
  );
  const calendars: ComposerCalendar[] = useMemo(
    () => [
      { id: "moduo", name: "Your calendar", google: false },
      ...accounts
        .filter((a) => a.provider === "google")
        .map((a) => ({ id: a.id, name: a.label, google: true })),
    ],
    [accounts],
  );
  const people: ComposerPerson[] = useMemo(
    () => [
      ...members
        .filter((m) => m.userId !== userId)
        .map((m) => ({ id: m.userId, name: m.name, email: null, member: true })),
      ...contacts,
    ],
    [members, contacts, userId],
  );

  // The latest inputs for the create listener, which subscribes once.
  const latest = useRef({ canEdit, cursor, busyOn, prefs, runtime, workspaceId });
  useEffect(() => {
    latest.current = { canEdit, cursor, busyOn, prefs, runtime, workspaceId };
  });

  useEffect(
    () =>
      onCreateNew(() => {
        const k = latest.current;
        const seed = teammatesState().composerSeed;
        setTeammates({ composerSeed: null });
        if (!k.canEdit) return;
        const box = document.querySelector<HTMLInputElement>("[data-calendar-composer] input");
        if (box) {
          box.focus();
          return;
        }
        opener.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const base = openingSlot({
          nowMs: Date.now(),
          cursor: k.cursor
            ? { dayStartMs: dayStartOfKey(k.cursor.dayKey), minute: k.cursor.minute }
            : null,
          workStartMinute: k.prefs.workStartMinute,
          workEndMinute: k.prefs.workEndMinute,
          busyOn: freeForAll(k.busyOn, teammatesState().blocks, seed?.ids ?? []),
        });
        setOpen({ base, text: seed?.text ?? "", hop: null });
        if (k.runtime && k.workspaceId) {
          void loadContacts(k.runtime, k.workspaceId).then(setContacts);
        }
      }),
    [],
  );

  const parsed = useMemo(() => {
    if (!open) return null;
    const ctx = {
      nowMs: Date.now(),
      base: open.base,
      workStartMinute: prefs.workStartMinute,
      workEndMinute: prefs.workEndMinute,
      busyOn,
      calendars,
      people,
    };
    const first = parseComposer(open.text, ctx);
    const ids = first.people.filter((x) => x.member).map((x) => x.id);
    // A bare day's first free time is free for everyone named too.
    const p =
      ids.length > 0
        ? parseComposer(open.text, { ...ctx, busyOn: freeForAll(busyOn, blocks, ids) })
        : first;
    if (open.hop && open.hop.whenKey === p.whenKey) {
      return { ...p, startMs: open.hop.startMs, endMs: open.hop.endMs, firstFree: false };
    }
    return p;
  }, [open, prefs.workStartMinute, prefs.workEndMinute, busyOn, calendars, people, blocks]);
  const namedKey = parsed?.people
    .filter((x) => x.member)
    .map((x) => x.id)
    .join(",");
  useEffect(() => {
    setTeammates({ named: namedKey ? namedKey.split(",") : [] });
  }, [namedKey]);
  useEffect(() => () => setTeammates({ named: [] }), []);
  const plan = useMemo(
    () => (parsed ? planComposer(parsed, { accounts }) : null),
    [parsed, accounts],
  );

  // The draft on the grid, and the box beside it.
  const draftStart = parsed?.startMs;
  const draftEnd = parsed?.endMs;
  const draftTitle = parsed?.title;
  useEffect(() => {
    if (draftStart === undefined || draftEnd === undefined) {
      setComposerDraft(null);
      return;
    }
    setComposerDraft({ title: draftTitle ?? "", startMs: draftStart, endMs: draftEnd });
    const frame = requestAnimationFrame(() => {
      document
        .querySelector("[data-composer-ghost]")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      setPosition(placeBox(boxRef.current?.firstElementChild as HTMLElement | null));
    });
    return () => cancelAnimationFrame(frame);
  }, [draftStart, draftEnd, draftTitle]);
  useEffect(() => () => setComposerDraft(null), []);

  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const follow = () =>
      setPosition(placeBox(boxRef.current?.firstElementChild as HTMLElement | null));
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [isOpen]);

  const close = useCallback(() => {
    setOpen(null);
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }, []);

  // A click away closes an empty box; a typed one stays until esc or ↵.
  const empty = open?.text.trim() === "";
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!empty) return;
      if (boxRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [isOpen, empty, close]);

  if (!open || !parsed || !plan) return null;

  const named = parsed.people.filter((x) => x.member);
  const namedIds = named.map((x) => x.id);
  const hop = (direction: 1 | -1) => {
    const next = hopFreeTime({
      startMs: parsed.startMs,
      endMs: parsed.endMs,
      direction,
      nowMs: Date.now(),
      workStartMinute: prefs.workStartMinute,
      workEndMinute: prefs.workEndMinute,
      busyOn: freeForAll(busyOn, blocks, namedIds),
    });
    if (next) setOpen({ ...open, hop: { whenKey: parsed.whenKey, ...next } });
  };

  const commit = () => {
    if (!parsed.title) return;
    const google = plan.target.kind === "google" ? plan.target.accountId : null;
    const native = plan.target.kind === "moduo" ? plan.target.calendarId : null;
    createEvent({
      title: parsed.title,
      startsAt: new Date(parsed.startMs).toISOString(),
      endsAt: new Date(parsed.endMs).toISOString(),
      allDay: false,
      rrule: null,
      calendarId: google ?? "moduo",
      nativeCalendarId: native ?? undefined,
      location: parsed.place ?? undefined,
      attendees: plan.attendees.length > 0 ? plan.attendees : undefined,
      kind: parsed.kind === "focus" ? "focus" : undefined,
      meet: plan.meet ? "add" : undefined,
    });
    close();
  };

  const calendarLabel =
    plan.target.kind === "google"
      ? (accounts.find((a) => a.id === (plan.target as { accountId: string }).accountId)?.label ??
        "Google")
      : "Your calendar";

  return (
    <div ref={boxRef}>
      <EventComposer
        text={open.text}
        parse={parsed}
        plan={plan}
        calendarLabel={calendarLabel}
        clash={clashFor(parsed.startMs, parsed.endMs, busyOn)}
        verdicts={verdictsEcho(
          named.map((x) => ({
            name: x.name,
            verdict: verdictFor(
              blocks,
              x.id,
              parsed.startMs,
              parsed.endMs,
              teammates.some((t) => t.userId === x.id),
            ),
          })),
        )}
        position={position}
        onText={(text) => setOpen({ ...open, text })}
        onHop={hop}
        onCommit={commit}
        onCancel={close}
      />
    </div>
  );
}
