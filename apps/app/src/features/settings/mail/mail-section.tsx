// Settings → Mail (MR-15): connects `MailSettingsView` to the runtime.
// Behavior toggles sync through `user_preferences.email.behavior`; lists sync
// per row through the MR-7 mirror; accounts, depth, storage, cap, Clear and
// the default mail app go to this Mac's engine (desktop only).

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { disconnectMailAccount, unsentCopy } from "@/features/email/disconnect";
import { asHistoryDepth } from "@/features/email/history-depth";
import { useEmailPrefs } from "@/features/email/hooks/use-email-prefs";
import {
  type EmailSettingsMirror,
  startEmailSettingsMirror,
} from "@/features/email/settings/mirror";
import { getRuntime } from "@/lib/runtime";
import type { EmailSettingsItem } from "@/lib/runtime.types.email";
import type { MailStorageStats } from "@/lib/runtime.types.mail-settings";
import { useAuth } from "@/providers/auth-provider";

import { SettingsSectionShell } from "../sections/section-shell";
import type { SettingsAccount } from "./accounts-group";
import { MailSettingsView } from "./mail-settings-view";
import { gbToBytes, itemsOfKind, newItemId, nextPosition } from "./model";

const EMPTY: EmailSettingsItem[] = [];
const noop = () => () => {};

function fail(what: string) {
  return (e: unknown) => toast.error(e instanceof Error ? e.message : `Couldn’t ${what}.`);
}

/** A legacy or engine account row → the Settings row. */
export function toSettingsAccount(raw: Record<string, unknown>): SettingsAccount {
  const state = String(raw.syncState ?? raw.status ?? "idle");
  const needsReconnect = state === "reconnect" || state === "error" || raw.needsReauth === true;
  const status =
    state === "reconnect"
      ? "Needs you to sign in again"
      : state === "error"
        ? String(raw.lastError ?? "Can’t sync")
        : state === "offline"
          ? "Offline"
          : state === "idle"
            ? "Up to date"
            : "Syncing…";
  return {
    id: String(raw.id ?? raw.accountId ?? ""),
    address: String(raw.address ?? raw.email ?? raw.username ?? ""),
    status,
    needsReconnect,
    depth: asHistoryDepth(raw.historyDepth),
  };
}

function useMirror(userId: string | null): EmailSettingsMirror | null {
  const [mirror, setMirror] = useState<EmailSettingsMirror | null>(null);
  useEffect(() => {
    if (!userId) return;
    const started = startEmailSettingsMirror(userId);
    setMirror(started?.mirror ?? null);
    return () => started?.stop();
  }, [userId]);
  return mirror;
}

export function MailSection() {
  const { userId } = useAuth();
  const { prefs, setBehavior } = useEmailPrefs(userId ?? "anon");
  const mirror = useMirror(userId);
  const items = useSyncExternalStore(mirror?.subscribe ?? noop, mirror?.items ?? (() => EMPTY));
  const email = getRuntime()?.email;
  const engine = email?.settings ?? null;
  const [accounts, setAccounts] = useState<SettingsAccount[]>([]);
  const [stats, setStats] = useState<MailStorageStats[]>([]);
  const [isDefault, setIsDefault] = useState(false);

  const reload = useCallback(async () => {
    if (!email) return;
    const rows = email.engine ? await email.engine.listAccounts() : await email.listAccounts();
    setAccounts((rows as Record<string, unknown>[]).map(toSettingsAccount));
    if (engine) {
      setStats(await engine.storageStats());
      setIsDefault(await engine.isDefaultMailApp());
    }
  }, [email, engine]);

  useEffect(() => {
    void reload().catch(() => {});
  }, [reload]);

  const after = (p: Promise<unknown>, what: string, done?: string) =>
    void p
      .then(() => {
        if (done) toast.success(done);
        return reload();
      })
      .catch(fail(what));

  return (
    <SettingsSectionShell
      title="Mail"
      description="Accounts, rules, snippets and how mail behaves."
    >
      <MailSettingsView
        behavior={prefs.behavior}
        onBehavior={setBehavior}
        items={items}
        itemActions={{
          add: (kind, value) => {
            if (!mirror) return;
            const position = nextPosition(itemsOfKind(items, kind));
            void mirror.upsert({ id: newItemId(), kind, value, position }).catch(fail("save that"));
          },
          update: (item, value, position) => {
            if (!mirror) return;
            void mirror
              .upsert({ id: item.id, kind: item.kind, value, position: position ?? item.position })
              .catch(fail("save that"));
          },
          remove: (id) => void mirror?.remove(id).catch(fail("delete that")),
        }}
        accounts={accounts}
        accountActions={{
          reconnect: (id) =>
            after(email?.syncNow({ accountId: id }) ?? Promise.resolve(), "reconnect"),
          disconnect: (id) => {
            if (!email) return;
            void disconnectMailAccount(
              email,
              id,
              (unsent, proceed) =>
                toast(unsentCopy(unsent), {
                  action: { label: "Disconnect anyway", onClick: proceed },
                }),
              () => {
                toast.success("Disconnected");
                void reload().catch(() => {});
              },
            ).catch(fail("disconnect"));
          },
          setDepth: (id, depth) =>
            after(
              email?.setHistoryDepth({ accountId: id, depth }) ?? Promise.resolve(),
              "change the depth",
            ),
        }}
        storage={
          engine
            ? {
                stats,
                actions: {
                  setCap: (id, gb) =>
                    after(
                      engine.setDiskCap({ accountId: id, bytes: gbToBytes(gb) }),
                      "set the cap",
                    ),
                  clearAttachments: (id) =>
                    after(engine.clearAttachments(id), "clear attachments", "Attachments cleared"),
                  clearDownloaded: (id) =>
                    after(
                      engine.clearDownloaded(id),
                      "clear downloaded mail",
                      "Downloaded mail cleared",
                    ),
                },
              }
            : null
        }
        defaultApp={
          engine
            ? {
                isDefault,
                make: () =>
                  after(
                    engine.makeDefaultMailApp().then((ok) => {
                      if (!ok) throw new Error("macOS didn’t make Moduo the default mail app.");
                    }),
                    "make Moduo the default",
                    "Moduo is now the default mail app",
                  ),
              }
            : null
        }
      />
    </SettingsSectionShell>
  );
}
