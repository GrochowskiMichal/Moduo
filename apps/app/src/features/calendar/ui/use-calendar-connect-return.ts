// Back from connecting Google or Zoom (say when it didn't take, ask first when
// this tab didn't start it: see connect-return.ts), and link the signed-in
// Google accounts into the calendar once they're known.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { CONNECT_FINISHED_EVENT, connectDoneMessage, takeConnectNotice } from "../connect-return";
import { ensureGoogleCalendarAccounts } from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";

type Input = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  calendar: CalendarModuleApi;
};

export function useCalendarConnectReturn({ runtime, workspaceId, calendar }: Input): void {
  const [connectTick, setConnectTick] = useState(0);
  useEffect(() => {
    const onConnected = () => setConnectTick((tick) => tick + 1);
    window.addEventListener(CONNECT_FINISHED_EVENT, onConnected);
    void takeConnectNotice().then((outcome) => {
      if (outcome?.status === "failed") toast.error(outcome.message);
      if (outcome?.status !== "confirm") return;
      toast(outcome.title, {
        description: "Only if you started connecting it, here or in the Moduo app.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Connect",
          onClick: () =>
            void outcome.confirm().then((done) => {
              if (done.status === "failed") toast.error(done.message);
              else toast(connectDoneMessage(done.provider));
            }),
        },
        cancel: { label: "Not now", onClick: () => {} },
      });
    });
    return () => window.removeEventListener(CONNECT_FINISHED_EVENT, onConnected);
  }, []);

  const accountKey = calendar.accounts
    .map((account) => `${account.externalId}:${account.deletedAt ?? ""}`)
    .join("|");
  const accountsRef = useRef(calendar.accounts);
  useEffect(() => {
    accountsRef.current = calendar.accounts;
  }, [calendar.accounts]);
  useEffect(() => {
    if (!runtime || !workspaceId || calendar.loading) return;
    void accountKey;
    void connectTick;
    let cancelled = false;
    void (async () => {
      try {
        const added = await ensureGoogleCalendarAccounts({
          runtime,
          workspaceId,
          accounts: accountsRef.current,
        });
        if (!cancelled && added) await calendar.reload();
      } catch (err) {
        console.warn("[calendar] google link", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, calendar.loading, calendar.reload, accountKey, connectTick]);
}
