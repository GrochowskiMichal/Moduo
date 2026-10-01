/**
 * Cancel page linked from the guest email (/book/cancel?token=).
 * Loading the page does not cancel — the guest confirms.
 */

import { useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { bookingRequest } from "../../features/calendar/booking/public-client";

type Preview = {
  status: string;
  start: string;
  hostName: string;
  name: string;
};

export function BookCancelPage() {
  const { token } = useSearch({ from: "/book/cancel" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [missing, setMissing] = useState(false);
  const [done, setDone] = useState(false);
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
    if (res.ok) setDone(true);
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
              The time is free again. Google will drop the calendar invite.
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
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "full",
                  timeStyle: "short",
                }).format(new Date(preview.start))}
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
