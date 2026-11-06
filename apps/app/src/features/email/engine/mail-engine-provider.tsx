// Mounted once in the app chrome (decision 11). On desktop it binds the mail
// engine to the app's store and runs the controller for the whole session;
// on the web there is no engine and it renders nothing and does nothing.
// `/email` only renders from the store.

import { useEffect, useRef, useState } from "react";

import { showAppBadgeSource } from "@/lib/notices/app-badge";
import { getRuntime } from "@/lib/runtime";
import type { MailEngine } from "@/lib/runtime.types.mail-engine";

import { useAuth } from "../../../providers/auth-provider";
import { startEmailSettingsMirror } from "../settings/mirror";
import { type MailStore, mailStore } from "../store/mail-store";
import {
  mailEngineMode,
  mailFixtureMessages,
  mailFixtureScenario,
  readMailBehavior,
} from "./behavior";
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

/** "fixture" mode: the in-memory reference mailbox, loaded on demand so the
 *  generator stays out of the main bundle (lab journeys, MR-16). */
function useFixtureEngine(wanted: boolean): MailEngine | null {
  const [engine, setEngine] = useState<MailEngine | null>(null);
  useEffect(() => {
    if (!wanted || engine) return;
    let gone = false;
    void Promise.all([import("../testing/fake-engine"), import("../testing/fixture")]).then(
      ([fake, fx]) => {
        if (gone) return;
        setEngine(
          fake.createFakeMailEngine({
            fixture: fx.generateFixture({ messages: mailFixtureMessages() }),
            now: () => Date.now(),
            scenario: mailFixtureScenario().filter(fake.isMailFixtureScenario),
          }),
        );
      },
    );
    return () => {
      gone = true;
    };
  }, [wanted, engine]);
  return wanted ? engine : null;
}

export type MailEngineProviderProps = {
  /** Tests and stories pass the fixture engine; the app reads the runtime's. */
  engine?: MailEngine | null;
  store?: MailStore;
  deps?: Partial<Omit<MailControllerDeps, "engine" | "store">>;
};

export function MailEngineProvider({ engine, store = mailStore, deps }: MailEngineProviderProps) {
  const mode = engine === undefined ? mailEngineMode() : null;
  const fixture = useFixtureEngine(mode === "fixture");
  const resolved =
    engine !== undefined
      ? engine
      : mode === "on"
        ? (getRuntime()?.email?.engine ?? null)
        : mode === "fixture"
          ? fixture
          : null;
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
  // The engine classifies new mail by your rules, tabs, Priority people and
  // blocks: the settings mirror pushes them to it (only the real engine).
  const { userId } = useAuth();
  const real = engine === undefined && mode === "on" && resolved !== null;
  useEffect(() => {
    if (!real || !userId) return;
    const started = startEmailSettingsMirror(userId);
    return () => started?.stop();
  }, [real, userId]);
  return null;
}
