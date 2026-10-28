// "Link a person, note or task" from an event menu (CALR-4b): the menu opens
// the Event panel on that event and asks its Link row to open its picker,
// the way L does. The ask waits briefly for the panel to mount; one that no
// panel took in time is dropped, so it can't pop up on a later visit.

import { useEffect } from "react";

const EVENT = "moduo:calendar-link-request";
const FRESH_MS = 2_000;

let pending: { eventId: string; at: number } | null = null;

export function requestEventLink(eventId: string): void {
  pending = { eventId, at: Date.now() };
  window.dispatchEvent(new Event(EVENT));
}

/** The Link row of the Event panel showing `eventId` opens its picker when asked. */
export function useEventLinkRequest(eventId: string, enabled: boolean, open: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const take = () => {
      if (!pending || pending.eventId !== eventId) return;
      const fresh = Date.now() - pending.at < FRESH_MS;
      pending = null;
      if (fresh) open();
    };
    take();
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
  }, [eventId, enabled, open]);
}
