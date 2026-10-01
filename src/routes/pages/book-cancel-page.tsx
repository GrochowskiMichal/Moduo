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
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-4 bg-background px-6 py-10 text-foreground">
      {missing ? (
        <p className="text-sm text-foreground">This cancel link is not available.</p>
      ) : null}
      {done ? <h1 className="font-display text-xl text-foreground">Booking cancelled</h1> : null}
      {!done && preview ? (
        <>
          <h1 className="font-display text-xl text-foreground">Cancel this booking?</h1>
          <p className="text-sm text-foreground">
            {preview.name} with {preview.hostName}
          </p>
          <p className="text-sm text-muted-foreground">
            {new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(
              new Date(preview.start),
            )}
          </p>
          {preview.status === "cancelled" ? (
            <p className="text-sm text-muted-foreground">This booking is already cancelled.</p>
          ) : (
            <Button type="button" disabled={busy} onClick={() => void cancel()}>
              Cancel booking
            </Button>
          )}
        </>
      ) : null}
    </main>
  );
}
