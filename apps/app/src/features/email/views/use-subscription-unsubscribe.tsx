// Subscriptions' Unsubscribe (AC29) on the engine: the same vetted plan as the
// reader (one-click, a confirmed mailto naming its recipient, the web page),
// with the confirm shown above the list.

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { MailEngine } from "@/lib/runtime.types.mail-engine";

import { unsubscribeSender } from "../reader/engine-reader";

export function useSubscriptionUnsubscribe(engine: MailEngine | null) {
  const [unsubscribed, setUnsubscribed] = useState<ReadonlySet<string>>(new Set());
  const [ask, setAsk] = useState<{ to: string; resolve: (ok: boolean) => void } | null>(null);

  const unsubscribe = async (email: string, threadIds: string[]) => {
    if (!engine) return;
    try {
      const notice = await unsubscribeSender(engine, threadIds, {
        confirmMailto: (to) => new Promise<boolean>((resolve) => setAsk({ to, resolve })),
        openUrl: (url) => window.open(url, "_blank", "noopener"),
      });
      toast.success(notice);
      setUnsubscribed((s) => new Set([...s, email]));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't unsubscribe.");
    } finally {
      setAsk(null);
    }
  };

  const confirm = ask ? (
    <div
      role="alertdialog"
      aria-label="Confirm unsubscribe email"
      className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground"
    >
      <span>
        Send an email saying “unsubscribe” to{" "}
        <span className="font-medium text-foreground">{ask.to}</span>?
      </span>
      <Button size="sm" variant="outline" onClick={() => ask.resolve(true)}>
        Send
      </Button>
      <Button size="sm" variant="ghost" onClick={() => ask.resolve(false)}>
        Cancel
      </Button>
    </div>
  ) : null;

  return { unsubscribe, unsubscribed, confirm };
}
