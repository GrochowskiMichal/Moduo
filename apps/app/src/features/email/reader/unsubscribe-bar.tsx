// Unsubscribe in the reader (AC19) on the engine: one-click first, a confirm
// before a mailto is sent for you, the web page last; the notice names the
// fallback. Hidden when the newest message has no List-Unsubscribe.

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { MailEngine, MailThread } from "@/lib/runtime.types.mail-engine";

import { runEngineUnsubscribe, unsubscribeMessage } from "./engine-reader";

export function UnsubscribeBar({ engine, thread }: { engine: MailEngine; thread: MailThread }) {
  const [asking, setAsking] = useState<((ok: boolean) => void) | null>(null);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const m = unsubscribeMessage(thread.messages);
  if (!m || !engine.unsubscribe) return null;

  const run = async () => {
    setBusy(true);
    try {
      const notice = await runEngineUnsubscribe(engine, thread.row.threadId, m.id, {
        confirmMailto: (to) =>
          new Promise<boolean>((resolve) => {
            setRecipient(to);
            setAsking(() => resolve);
          }),
        openUrl: (url) => window.open(url, "_blank", "noopener"),
      });
      toast.success(notice);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't unsubscribe.");
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };
  const answer = (ok: boolean) => {
    asking?.(ok);
    setAsking(null);
  };

  return (
    <div className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground">
      {asking ? (
        <>
          <span>
            Send an email saying “unsubscribe” to{" "}
            <span className="font-medium text-foreground">{recipient}</span>?
          </span>
          <Button size="sm" variant="outline" onClick={() => answer(true)}>
            Send
          </Button>
          <Button size="sm" variant="ghost" onClick={() => answer(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run()}>
          Unsubscribe
        </Button>
      )}
    </div>
  );
}
