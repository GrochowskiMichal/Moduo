// The Booking link view's glue (CALR-17, AC31, AC32): opening a rail link
// pushes it as a right-panel item, reads it through the runtime and the guest
// page's own answer, and dashes its open times on the week. Quick edits are
// optimistic and roll back on failure.

import { isClosedTask } from "@contracts/vocabularies";
import { CalendarClock } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { PanelItem } from "../../../components/app/right-panel";
import { isTauriRuntime } from "../../../lib/runtime";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { BookingLinkRow } from "../../../lib/runtime.types.calendar";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import type { Task, TaskSession } from "../../tasks/model";
import { useWorkspace } from "../../workspaces/workspace-context";
import { openTimes, type OpenTimesInput } from "../booking/availability";
import {
  type BookingLink,
  busyIdsFromJson,
  FOCUS_BUSY_ID,
  questionsFromJson,
} from "../booking/model";
import { offerSlots } from "../booking/offer";
import { bookingRequest } from "../booking/public-client";
import { bookingPublicUrl } from "../booking/public-origin";
import { normalizeWeeklyHours } from "../booking/slots";
import { videoSetting } from "../booking/video";
import type { CalendarAccountModel, CalendarEventModel } from "../events";
import type { CalendarView } from "../lens";
import { BookingLinkPanel, type BookingLinkPanelProps } from "./booking-link-panel";
import { BookingOpenLayer } from "./booking-open-layer";
import { useNowTick } from "./grid-units";
import { useOfferMode } from "./use-offer-mode";

export const BOOKING_LINKS_CHANGED_EVENT = "moduo:booking-links-changed";
export const BOOKING_LINK_EDIT_EVENT = "moduo:booking-link-edit";

// The editor lives in the rail, which is unmounted while the calendars panel
// is folded: Edit… unfolds it and leaves the link here for the rail to take
// when it mounts (or at once, through the event, when it is already showing).
let pendingEdit: BookingLinkRow | null = null;

/** The link Edit… asked the rail's editor to open, once. */
export function takePendingBookingEdit(): BookingLinkRow | null {
  const row = pendingEdit;
  pendingEdit = null;
  return row;
}

function requestBookingLinkEdit(row: BookingLinkRow) {
  pendingEdit = row;
  const state = readFeaturePanelState("calendar");
  if (!state.left) dispatchLayoutPanelsSet({ feature: "calendar", left: true, right: state.right });
  window.dispatchEvent(new Event(BOOKING_LINK_EDIT_EVENT));
}

type Read = NonNullable<Awaited<ReturnType<ModuoRuntime["calendar"]["bookingLink"]>>>;
type Loaded = Omit<Read, "link"> & { link: BookingLink; row: BookingLinkRow };
type Patch = Parameters<BookingLinkPanelProps["onPatch"]>[0];

type Input = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  userId: string;
  accounts: CalendarAccountModel[];
  events: CalendarEventModel[];
  sessions: TaskSession[];
  /** Live tasks: work sessions on finished ones don't count, as on the guest page. */
  tasks: readonly Pick<Task, "id" | "status" | "statusCategory">[];
  days: Date[];
  view: CalendarView;
  hasSelection: boolean;
  /** The page's detail target: opening an event or a task takes the panel over. */
  closeKey: unknown;
};

function linkFromRow(row: BookingLinkRow): BookingLink {
  return {
    id: row.id,
    slotId: row.slot_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    horizonDays: row.date_range_days,
    minNoticeMinutes: row.min_notice_minutes,
    hostTimeZone: row.host_timezone || "UTC",
    weeklyHours: normalizeWeeklyHours(row.weekly_hours),
    busyCalendarIds: busyIdsFromJson(row.busy_calendar_ids),
    noteEnabled: row.note_enabled,
    guestsEnabled: row.guests_enabled,
    questions: questionsFromJson(row.questions_json),
    paused: row.paused,
    videoProvider: videoSetting(row.video_provider),
  };
}

function useLinkData(runtime: ModuoRuntime | null, workspaceId: string, linkId: string | null) {
  const [data, setData] = useState<Loaded | null>(null);
  useEffect(() => {
    setData(null);
    if (!runtime || !linkId) return;
    let live = true;
    const read = () =>
      void runtime.calendar
        .bookingLink({ linkId, workspaceId })
        .then((next) => {
          if (live) setData(next && { ...next, row: next.link, link: linkFromRow(next.link) });
        })
        .catch(() => toast.error("Couldn't read the booking link."));
    read();
    window.addEventListener(BOOKING_LINKS_CHANGED_EVENT, read);
    return () => {
      live = false;
      window.removeEventListener(BOOKING_LINKS_CHANGED_EVENT, read);
    };
  }, [runtime, workspaceId, linkId]);
  return [data, setData] as const;
}

/**
 * The guest page's open times, read again ~1.5 s after the week or the link
 * changes. An answer for another length is dropped, so a new Length doesn't
 * filter its times by the old length's starts while the read is on its way.
 */
function useGuestSlots(
  slug: string | null,
  link: { durationMinutes: number } | null,
  events: unknown,
  sessions: unknown,
) {
  const [answer, setAnswer] = useState<{ key: string; slots: string[] | null } | null>(null);
  const key = `${slug}:${link?.durationMinutes}`;
  useEffect(() => {
    if (!slug) return;
    const setSlots = (slots: string[] | null) => setAnswer({ key, slots });
    let live = true;
    const timer = window.setTimeout(() => {
      bookingRequest({ action: "preview", slug })
        .then((res) => {
          const next =
            res.ok && Array.isArray(res.json.slots) ? (res.json.slots as string[]) : null;
          if (live) setSlots(next);
        })
        .catch(() => {
          if (live) setSlots(null);
        });
    }, 1500);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [slug, key, link, events, sessions]);
  return answer?.key === key ? answer.slots : null;
}

export function useBookingPanel(input: Input): {
  open: (linkId: string) => void;
  items: PanelItem[];
  close: () => void;
  layer: ReactNode;
} {
  const { runtime, workspaceId, userId, accounts, events, days } = input;
  const { members } = useWorkspace();
  const [linkId, setLinkId] = useState<string | null>(null);
  // Opening an event or a task, or another workspace, closes the view.
  const [seen, setSeen] = useState({ key: input.closeKey, workspaceId });
  if (seen.key !== input.closeKey || seen.workspaceId !== workspaceId) {
    setSeen({ key: input.closeKey, workspaceId });
    setLinkId(null);
  }
  const [data, setData] = useLinkData(runtime, workspaceId, linkId);
  const sessions = useMemo(() => {
    const open = new Set(input.tasks.filter((t) => !isClosedTask(t)).map((t) => t.id));
    return input.sessions.filter((s) => open.has(s.taskId));
  }, [input.tasks, input.sessions]);
  const now = useNowTick(60_000);
  const link = data?.link ?? null;
  const guestSlots = useGuestSlots(link?.slug ?? null, link, events, sessions);

  const open = useCallback((id: string) => {
    setLinkId(id);
    const state = readFeaturePanelState("calendar");
    if (!state.right)
      dispatchLayoutPanelsSet({ feature: "calendar", left: state.left, right: true });
  }, []);
  const close = useCallback(() => setLinkId(null), []);

  const hosts = useMemo(
    () =>
      (data?.hosts ?? []).map((h) => ({
        ...h,
        name: members.find((m) => m.userId === h.userId)?.displayName || "Teammate",
      })),
    [data, members],
  );
  // Accepted co-hosts' events and busy blocks the app can read (focus stays
  // free unless the link ticks it): never more times than the guest page.
  const coHostBusy = useMemo(() => {
    const ids = new Set(hosts.filter((h) => h.status === "accepted").map((h) => h.userId));
    const focusBusy = data?.link.busyCalendarIds.includes(FOCUS_BUSY_ID) ?? false;
    return events.filter(
      (e) =>
        e.ownerId != null &&
        ids.has(e.ownerId) &&
        !e.deletedAt &&
        (focusBusy || e.kind !== "focus"),
    );
  }, [hosts, events, data]);
  const from = days[0];
  const last = days[days.length - 1];
  const openInput = useMemo((): OpenTimesInput | null => {
    if (!data || !from || !last) return null;
    return {
      link: data.link,
      hostId: userId,
      events,
      sessions,
      bookings: data.bookings,
      coHostBusy,
      hosts,
      guestSlots,
      now,
      from,
      to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
    };
  }, [data, userId, events, sessions, hosts, coHostBusy, guestSlots, from, last, now]);
  const result = useMemo(
    () => (openInput ? openTimes(openInput) : { state: "open" as const, times: [] }),
    [openInput],
  );
  const slots = useMemo(() => (openInput ? offerSlots(openInput) : []), [openInput]);
  const offer = useOfferMode({ runtime, workspaceId, userId, link, slots, openLink: open });

  const patch = useCallback(
    (change: Patch) => {
      if (!runtime || !data) return;
      const before = data;
      setData({ ...data, link: { ...data.link, ...change } });
      runtime.calendar
        .updateBookingLink({ linkId: data.link.id, patch: change })
        .then(() => window.dispatchEvent(new Event(BOOKING_LINKS_CHANGED_EVENT)))
        .catch((e: unknown) => {
          // Only if the view still shows that link.
          setData((current) => (current?.link.id === before.link.id ? before : current));
          toast.error(e instanceof Error ? e.message : "Couldn't save the link.");
        });
    },
    [runtime, data, setData],
  );

  const items: PanelItem[] = [];
  if (link && data) {
    const url = bookingPublicUrl(link.slug, window.location);
    items.push({
      key: `booking:${link.id}`,
      title: link.name,
      icon: CalendarClock,
      render: () =>
        offer.active ? (
          offer.card()
        ) : (
          <BookingLinkPanel
            link={link}
            url={url}
            hosts={hosts}
            bookings={data.bookings}
            open={result}
            accounts={accounts}
            landsIn={
              accounts.some((a) => a.provider === "google")
                ? "Your main Google calendar"
                : "Your calendar · Moduo"
            }
            hasSelection={input.hasSelection}
            onPatch={patch}
            onEdit={() => requestBookingLinkEdit(data.row)}
            onGuestView={() => {
              if (isTauriRuntime() && runtime) void runtime.window.openExternalUrl(url);
              else window.open(url, "_blank", "noopener");
            }}
            onOffer={offer.start}
          />
        ),
    });
  }

  const { picks, cursorMs } = offer.draft;
  const length = (link?.durationMinutes ?? 0) * 60_000;
  const shown = offer.active
    ? [...picks, ...(cursorMs == null ? [] : [cursorMs])].map((ms) => ({
        startMs: ms,
        endMs: ms + length,
      }))
    : result.times;
  const layer =
    link && input.view !== "month" ? (
      <BookingOpenLayer days={days} times={shown} picked={offer.active ? picks : undefined} />
    ) : null;
  return { open, items, close, layer };
}
