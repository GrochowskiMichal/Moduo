// Mounted once in the app chrome (decision 11). On desktop it binds the mail
// engine to the app's store and runs the controller for the whole session;
// on the web there is no engine and it renders nothing and does nothing.
// `/email` only renders from the store.

import { useEffect, useRef, useState } from "react";

import { showAppBadgeSource } from "@/lib/notices/app-badge";
import { getRuntime } from "@/lib/runtime";
import type { MailComposeEngine } from "@/lib/runtime.types.mail-compose";
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

type FixturePorts = {
  engine: MailEngine;
  compose: MailComposeEngine & { uploadDrafts(): void };
};

/** How often the fixture "uploads" local drafts, standing in for the engine's 2 s debounce. */
const FIXTURE_UPLOAD_MS = 2000;

/** "fixture" mode: the in-memory reference mailbox and a compose port beside it,
 *  loaded on demand so the generator stays out of the main bundle (lab journeys,
 *  MR-16). The compose fake's draft uploads come back as the fixture engine's
 *  `draft_changed`, as the real engine emits them (specs/mail-v3.md MV-3). */
function useFixturePorts(wanted: boolean): FixturePorts | null {
  const [ports, setPorts] = useState<FixturePorts | null>(null);
  useEffect(() => {
    if (!wanted || ports) return;
    let gone = false;
    void Promise.all([
      import("../testing/fake-engine"),
      import("../testing/fixture"),
      import("../testing/fake-compose"),
    ]).then(([fake, fx, fc]) => {
      if (gone) return;
      const scenario = mailFixtureScenario();
      const engine = fake.createFakeMailEngine({
        fixture: fx.generateFixture({ messages: mailFixtureMessages() }),
        now: () => Date.now(),
        scenario: scenario.filter(fake.isMailFixtureScenario),
      });
      const compose = fc.createFakeCompose({
        now: () => Date.now(),
        scenario: scenario.filter(fc.isFakeComposeScenario),
        onDraftChanged: (draftId, serverUid) =>
          engine.emitEvent({ kind: "draft_changed", draftId, serverUid }),
      });
      setPorts({ engine, compose });
    });
    return () => {
      gone = true;
    };
  }, [wanted, ports]);
  useEffect(() => {
    if (!wanted || !ports) return;
    const timer = setInterval(() => ports.compose.uploadDrafts(), FIXTURE_UPLOAD_MS);
    return () => clearInterval(timer);
  }, [wanted, ports]);
  return wanted ? ports : null;
}

export type MailEngineProviderProps = {
  /** Tests and stories pass the fixture engine; the app reads the runtime's. */
  engine?: MailEngine | null;
  store?: MailStore;
  deps?: Partial<Omit<MailControllerDeps, "engine" | "store">>;
};

export function MailEngineProvider({ engine, store = mailStore, deps }: MailEngineProviderProps) {
  const mode = engine === undefined ? mailEngineMode() : null;
  const fixture = useFixturePorts(mode === "fixture");
  const resolved =
    engine !== undefined
      ? engine
      : mode === "on"
        ? (getRuntime()?.email?.engine ?? null)
        : mode === "fixture"
          ? (fixture?.engine ?? null)
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
  // The fixture's compose port, for the page to read beside the fixture engine.
  const fixtureCompose = fixture?.compose ?? null;
  useEffect(() => {
    if (!fixtureCompose) return;
    store.setState({ compose: fixtureCompose });
    return () => store.setState({ compose: null });
  }, [fixtureCompose, store]);
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
