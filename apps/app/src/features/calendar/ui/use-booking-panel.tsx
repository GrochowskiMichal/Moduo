// The Booking link view's glue (CALR-17, AC31, AC32): opening a rail link
// pushes it as a right-panel item, reads it through the runtime and the guest
// page's own answer, and dashes its open times on the week. Quick edits are
// optimistic and roll back on failure.

import { CalendarClock } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { PanelItem } from "../../../components/app/right-panel";
import { isTauriRuntime } from "../../../lib/runtime";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { BookingLinkRow } from "../../../lib/runtime.types.calendar";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import type { TaskSession } from "../../tasks/model";
import { useWorkspace } from "../../workspaces/workspace-context";
import { openTimes } from "../booking/availability";
import {
  type BookingLink,
  busyIdsFromJson,
  FOCUS_BUSY_ID,
  questionsFromJson,
} from "../booking/model";
import { bookingRequest } from "../booking/public-client";
import { bookingPublicUrl } from "../booking/public-origin";
import { normalizeWeeklyHours } from "../booking/slots";
import { videoSetting } from "../booking/video";
import type { CalendarAccountModel, CalendarEventModel } from "../events";
import type { CalendarView } from "../lens";
import { BookingLinkPanel, type BookingLinkPanelProps } from "./booking-link-panel";
import { BookingOpenLayer } from "./booking-open-layer";

export const BOOKING_LINKS_CHANGED_EVENT = "moduo:booking-links-changed";
export const BOOKING_LINK_EDIT_EVENT = "moduo:booking-link-edit";

type Read = NonNullable<Awaited<ReturnType<ModuoRuntime["calendar"]["bookingLink"]>>>;
type Loaded = Omit<Read, "link"> & { link: BookingLink };
type Patch = Parameters<BookingLinkPanelProps["onPatch"]>[0];

type Input = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  userId: string;
  accounts: CalendarAccountModel[];
  events: CalendarEventModel[];
  sessions: TaskSession[];
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

function useLinkData(runtime: ModuoRuntime | null, linkId: string | null) {
  const [data, setData] = useState<Loaded | null>(null);
  useEffect(() => {
    setData(null);
    if (!runtime || !linkId) return;
    let live = true;
    const read = () =>
      void runtime.calendar
        .bookingLink({ linkId })
        .then((next) => {
          if (live) setData(next && { ...next, link: linkFromRow(next.link) });
        })
        .catch(() => toast.error("Couldn't read the booking link."));
    read();
    window.addEventListener(BOOKING_LINKS_CHANGED_EVENT, read);
    return () => {
      live = false;
      window.removeEventListener(BOOKING_LINKS_CHANGED_EVENT, read);
    };
  }, [runtime, linkId]);
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
  const { runtime, userId, accounts, events, sessions, days } = input;
  const { members } = useWorkspace();
  const [linkId, setLinkId] = useState<string | null>(null);
  const [seenKey, setSeenKey] = useState(input.closeKey);
  if (seenKey !== input.closeKey) {
    setSeenKey(input.closeKey);
    setLinkId(null);
  }
  const [data, setData] = useLinkData(runtime, linkId);
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
  const result = useMemo(() => {
    if (!data || !from || !last) return { state: "open" as const, times: [] };
    return openTimes({
      link: data.link,
      hostId: userId,
      events,
      sessions,
      bookings: data.bookings,
      coHostBusy,
      hosts,
      guestSlots,
      now: new Date(),
      from,
      to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
    });
  }, [data, userId, events, sessions, hosts, coHostBusy, guestSlots, from, last]);

  const patch = useCallback(
    (change: Patch) => {
      if (!runtime || !data) return;
      const before = data;
      setData({ ...data, link: { ...data.link, ...change } });
      runtime.calendar
        .updateBookingLink({ linkId: data.link.id, patch: change })
        .then(() => window.dispatchEvent(new Event(BOOKING_LINKS_CHANGED_EVENT)))
        .catch((e: unknown) => {
          setData(before);
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
      render: () => (
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
          onEdit={() =>
            window.dispatchEvent(
              new CustomEvent(BOOKING_LINK_EDIT_EVENT, { detail: { linkId: link.id } }),
            )
          }
          onGuestView={() => {
            if (isTauriRuntime() && runtime) void runtime.window.openExternalUrl(url);
            else window.open(url, "_blank", "noopener");
          }}
        />
      ),
    });
  }

  const layer =
    link && input.view !== "month" ? <BookingOpenLayer days={days} times={result.times} /> : null;
  return { open, items, close, layer };
}
