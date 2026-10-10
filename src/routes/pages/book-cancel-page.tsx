/**
 * Cancel page linked from the guest email (/book/cancel?token=).
 * Loading the page does not cancel — the guest confirms.
 */

import { useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { bookingRequest } from "../../features/calendar/booking/public-client";
import { dayLong, time24 } from "../../features/calendar/booking/sentence";

type Preview = {
  status: string;
  start: string;
  hostName: string;
  name: string;
};

/** "Friday 16 October at 14:00", in this device's zone (the booking page's format). */
function startLabel(iso: string): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const at = new Date(iso);
  try {
    return `${dayLong(at, zone)} at ${time24(at, zone)}`;
  } catch {
    return `${dayLong(at, "UTC")} at ${time24(at, "UTC")} UTC`;
  }
}

export function BookCancelPage() {
  const { token } = useSearch({ from: "/book/cancel" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [missing, setMissing] = useState(false);
  /** Set once cancelled: whether Google sends the cancellation (else our email's calendar file does). */
  const [done, setDone] = useState<{ googleInvites: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setMissing(true);
      return;
    }
    let active = true;
    void (async () => {
      const res = await bookingRequest({ action: "cancel-preview", token });
      if (!active) return;
      if (!res.ok) return setMissing(true);
      setPreview(res.json as unknown as Preview);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const cancel = async () => {
    if (!token) return;
    setBusy(true);
    const res = await bookingRequest({ action: "cancel", token });
    setBusy(false);
    if (res.ok) setDone({ googleInvites: res.json.googleInvites !== false });
  };

  return (
    <main className="flex min-h-dvh justify-center bg-background text-foreground sm:px-6 sm:py-10">
      <div className="flex w-full max-w-lg flex-col gap-6 bg-card p-6 sm:rounded-lg sm:border sm:border-border sm:p-10">
        {missing ? (
          <>
            <h1 className="font-display text-3xl text-foreground">This link is not available</h1>
            <p className="font-sans text-base text-muted-foreground">
              Ask the host if you still need to cancel.
            </p>
          </>
        ) : null}
        {done ? (
          <>
            <h1 className="font-display text-3xl text-foreground">Booking cancelled</h1>
            <p className="font-sans text-base text-muted-foreground">
              {done.googleInvites
                ? "The time is free again. Google will drop the calendar invite."
                : "The time is free again. An email with a calendar update that removes it is on its way."}
            </p>
          </>
        ) : null}
        {!done && preview ? (
          <>
            <h1 className="font-display text-3xl text-foreground">Cancel this booking?</h1>
            <div className="flex flex-col gap-1">
              <p className="font-sans text-lg text-foreground">
                {preview.name} with {preview.hostName}
              </p>
              <p className="font-sans text-base text-muted-foreground tabular-nums">
                {startLabel(preview.start)}
              </p>
            </div>
            {preview.status === "cancelled" ? (
              <p className="font-sans text-base text-muted-foreground">
                This booking is already cancelled.
              </p>
            ) : (
              <Button
                type="button"
                variant="destructive"
                size="lg"
                className="w-full sm:w-fit"
                disabled={busy}
                onClick={() => void cancel()}
              >
                {busy ? "Cancelling…" : "Cancel booking"}
              </Button>
            )}
          </>
        ) : null}
        {!missing && !done && !preview ? <div className="h-8 w-48 rounded-md bg-muted" /> : null}
      </div>
    </main>
  );
}
