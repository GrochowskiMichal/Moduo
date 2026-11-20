// Offer mode (CALR-19, AC34): O offers specific times from the booking link
// open in the right panel (else your first unpaused one). While offering, the
// keys pick times on the week (booking/offer.ts); the first copy makes the
// offer, later copies reuse it. Release holds (the card, or a hold's menu)
// releases them all.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppHotkeys } from "../../../lib/hotkeys";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { SlotOffer } from "../../../lib/runtime.types.calendar";
import type { BookingLink } from "../booking/model";
import {
  type OfferDraft,
  type OfferKey,
  offerKey,
  offerText,
  offerUrl,
  startOfferDraft,
} from "../booking/offer";
import { bookingPublicOrigin } from "../booking/public-origin";
import { OfferCard } from "./offer-card";
import { inCalendarOverlay } from "./use-calendar-hotkeys";

const OFFER_RELEASE_EVENT = "moduo:offer-release";

/** A hold's menu asks the page's offer mode to release its offer. */
export function requestOfferRelease(offerId: string) {
  window.dispatchEvent(new CustomEvent(OFFER_RELEASE_EVENT, { detail: offerId }));
}

const KEYS: Record<string, OfferKey> = {
  Enter: "add",
  Tab: "next",
  ArrowRight: "next-day",
  ArrowLeft: "prev-day",
  Backspace: "remove-last",
};

function ownsKey(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest("input, textarea, [contenteditable], button, [role='dialog']")
  );
}

type Input = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  userId: string;
  /** The booking link open in the right panel. */
  link: BookingLink | null;
  slots: number[];
  openLink: (linkId: string) => void;
};

export function useOfferMode({ runtime, workspaceId, userId, link, slots, openLink }: Input) {
  const [forLink, setForLink] = useState<string | null>(null);
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [hold, setHold] = useState(true);
  const [made, setMade] = useState<SlotOffer | null>(null);
  const making = useRef<Promise<SlotOffer | null> | null>(null);
  const active = link != null && link.id === forLink;
  const current = draft ?? startOfferDraft(slots);

  const begin = (linkId: string | null) => {
    setForLink(linkId);
    setDraft(null);
    setHold(true);
    setMade(null);
    making.current = null;
  };

  function start() {
    if (!link) return;
    begin(link.id);
    openLink(link.id);
  }

  const release = (offerId: string) =>
    runtime?.calendar.releaseOffer?.({ workspaceId, offerId }).then(
      () => toast.success("Holds released."),
      (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't release the holds."),
    );
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });
  useEffect(() => {
    const onRelease = (e: Event) => void releaseRef.current((e as CustomEvent<string>).detail);
    window.addEventListener(OFFER_RELEASE_EVENT, onRelease);
    return () => window.removeEventListener(OFFER_RELEASE_EVENT, onRelease);
  }, []);

  useAppHotkeys({
    "calendar.offer": (e) => {
      if (inCalendarOverlay(e)) return false;
      if (link) return start();
      void (
        runtime?.calendar.firstOpenBookingLink?.({ workspaceId, userId }) ?? Promise.resolve(null)
      )
        .catch(() => null)
        .then((id) => {
          if (!id) return void toast("Make a booking link first, then offer times from it.");
          begin(id);
          openLink(id);
        });
    },
  });

  const ensure = (): Promise<SlotOffer | null> => {
    if (made) return Promise.resolve(made);
    if (!making.current && link && runtime?.calendar.createOffer) {
      making.current = runtime.calendar
        .createOffer({
          workspaceId,
          linkId: link.id,
          startsAt: [...current.picks]
            .sort((a, b) => a - b)
            .map((ms) => new Date(ms).toISOString()),
          hold,
        })
        .then(
          (offer) => {
            setMade(offer);
            return offer;
          },
          (e: unknown) => {
            making.current = null;
            toast.error(e instanceof Error ? e.message : "Couldn't make the offer.");
            return null;
          },
        );
    }
    return making.current ?? Promise.resolve(null);
  };
  const url = made ? offerUrl(bookingPublicOrigin(window.location), made.slug) : null;
  const copy = (what: "link" | "text") => {
    if (!link || current.picks.length === 0) return;
    void ensure().then((offer) => {
      if (!offer) return;
      const at = offerUrl(bookingPublicOrigin(window.location), offer.slug);
      const text =
        what === "link"
          ? at
          : offerText({
              picks: current.picks,
              durationMinutes: link.durationMinutes,
              timeZone: link.hostTimeZone,
              url: at,
            });
      navigator.clipboard.writeText(text).then(
        () => toast.success(what === "link" ? "Offer link copied." : "Times copied."),
        () => toast.error("Couldn't copy."),
      );
    });
  };

  // The keys while offering, ahead of the week's own (capture).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (ownsKey(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      let act: (() => void) | null = null;
      if (mod && e.key.toLowerCase() === "c") act = () => copy(e.shiftKey ? "text" : "link");
      else if (mod || e.altKey) return;
      else if (e.key === "Escape") act = () => begin(null);
      else {
        const key = KEYS[e.key];
        // Once made, the offer's times are fixed.
        if (key && !(made && (key === "add" || key === "remove-last"))) {
          act = () => setDraft(offerKey(current, key, slots, link.hostTimeZone));
        }
      }
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const card = (): ReactNode =>
    link ? (
      <OfferCard
        title={link.name}
        durationMinutes={link.durationMinutes}
        timeZone={link.hostTimeZone}
        picks={current.picks}
        url={url}
        hold={hold}
        onHoldChange={setHold}
        onCopyLink={() => copy("link")}
        onCopyText={() => copy("text")}
        onRelease={
          made
            ? () => {
                void release(made.id);
                begin(null);
              }
            : undefined
        }
      />
    ) : null;

  return { active, start, draft: current, card };
}
