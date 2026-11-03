// Mounted once in the app chrome (decision 11). On desktop it binds the mail
// engine to the app's store and runs the controller for the whole session;
// on the web there is no engine and it renders nothing and does nothing.
// `/email` only renders from the store.

import { useEffect, useRef } from "react";

import { showAppBadgeSource } from "@/lib/notices/app-badge";
import { getRuntime } from "@/lib/runtime";
import type { MailEngine } from "@/lib/runtime.types.mail-engine";

import { type MailStore, mailStore } from "../store/mail-store";
import { mailEngineEnabled, readMailBehavior } from "./behavior";
import { createMailController, type MailControllerDeps } from "./controller";

async function notifyDesktop(title: string, body: string): Promise<void> {
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    let granted = await notification.isPermissionGranted();
    if (!granted) granted = (await notification.requestPermission()) === "granted";
    if (granted) notification.sendNotification({ title, body });
  } catch {
    /* no notifications on this platform */
  }
}

export type MailEngineProviderProps = {
  /** Tests and stories pass the fixture engine; the app reads the runtime's. */
  engine?: MailEngine | null;
  store?: MailStore;
  deps?: Partial<Omit<MailControllerDeps, "engine" | "store">>;
};

export function MailEngineProvider({ engine, store = mailStore, deps }: MailEngineProviderProps) {
  const resolved =
    engine === undefined
      ? mailEngineEnabled()
        ? (getRuntime()?.email.engine ?? null)
        : null
      : engine;
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  useEffect(() => {
    if (!resolved) return;
    const deps = depsRef.current;
    const controller = createMailController({
      engine: resolved,
      store,
      behavior: deps?.behavior ?? readMailBehavior(),
      setDockBadge: (n) => showAppBadgeSource("mail", n),
      notify: (title, body) => void notifyDesktop(title, body),
      ...deps,
    });
    void controller.start().catch((error) => {
      console.warn("[mail] engine start failed:", error);
    });
    return () => controller.stop();
  }, [resolved, store]);
  return null;
}
