// Settings → Mail (MR-15, specs/mail-v3.md §12): connects `MailSettingsView` to
// the runtime. Behavior toggles sync through `user_preferences.email.behavior`;
// lists sync per row through the MR-7 mirror; accounts, depth, storage, cap,
// Clear and the default mail app go to this Mac's engine (desktop only). The
// account cards read the mail store's live accounts when the engine runs, Sign
// in again opens the connect dialog in reconnect mode (as Mail does), and a new
// rule offers to apply itself to the mail already on this Mac.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { disconnectMailAccount, unsentCopy } from "@/features/email/disconnect";
import { useEmailPrefs } from "@/features/email/hooks/use-email-prefs";
import {
  type EmailSettingsMirror,
  startEmailSettingsMirror,
} from "@/features/email/settings/mirror";
import { useMailStore } from "@/features/email/store/use-mail-store";
import { ConnectSlot, type MailConnectRequest } from "@/features/email/ui/connect-slot";
import { getRuntime } from "@/lib/runtime";
import type { EmailSettingsItem } from "@/lib/runtime.types.email";
import type { MailAccount, MailEngine } from "@/lib/runtime.types.mail-engine";
import type { MailStorageStats } from "@/lib/runtime.types.mail-settings";
import { useAuth } from "@/providers/auth-provider";

import { SettingsSectionShell } from "../sections/section-shell";
import { toSettingsAccount } from "./accounts-group";
import { MailSettingsView } from "./mail-settings-view";
import { gbToBytes, itemsOfKind, newItemId, nextPosition } from "./model";
import type { RuleApplyPort } from "./rule-apply";

const EMPTY: EmailSettingsItem[] = [];
const noop = () => () => {};

function fail(what: string) {
  return (e: unknown) => toast.error(e instanceof Error ? e.message : `Couldn’t ${what}.`);
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The engine's apply-to-existing (AC7). The dry run waits for the new rule's
 * save, then retries briefly while the rule reaches the engine.
 */
function ruleApplyPort(
  engine: MailEngine | null,
  pending: Map<string, Promise<unknown>>,
): RuleApplyPort | null {
  if (!engine?.applyRuleExisting) return null;
  const run = engine.applyRuleExisting.bind(engine);
  return {
    async count(ruleId) {
      await pending.get(ruleId);
      for (let attempt = 0; ; attempt++) {
        try {
          return (await run({ ruleId, dryRun: true })).count;
        } catch (e) {
          if (attempt >= 3) throw e;
          await wait(400);
        }
      }
    },
    apply: (ruleId) => run({ ruleId, dryRun: false }),
    async undo(opIds) {
      for (const id of opIds) await engine.undoOp(id);
    },
  };
}

/** Accounts: the mail store's live rows while the engine runs, else a one-off read. */
function useAccounts(email: NonNullable<ReturnType<typeof getRuntime>>["email"] | undefined) {
  const live = useMailStore((s) => (s.engine ? s.accounts : null));
  const [read, setRead] = useState<Record<string, unknown>[]>([]);
  const reload = useCallback(async () => {
    if (!email) return;
    const rows = email.engine ? await email.engine.listAccounts() : await email.listAccounts();
    setRead(rows as Record<string, unknown>[]);
  }, [email]);
  const raw = (live as Record<string, unknown>[] | null) ?? read;
  const accounts = useMemo(() => raw.map((r, i) => toSettingsAccount(r, i)), [raw]);
  return { raw, accounts, reload };
}

export function MailSection() {
  const { userId } = useAuth();
  const { prefs, setBehavior } = useEmailPrefs(userId ?? "anon");
  const mirror = useMirror(userId);
  const items = useSyncExternalStore(mirror?.subscribe ?? noop, mirror?.items ?? (() => EMPTY));
  const email = getRuntime()?.email;
  const engine = email?.settings ?? null;
  const storeEngine = useMailStore((s) => s.engine);
  const mailEngine = storeEngine ?? email?.engine ?? null;
  const { raw, accounts, reload: reloadAccounts } = useAccounts(email);
  const [stats, setStats] = useState<MailStorageStats[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [connect, setConnect] = useState<MailConnectRequest | null>(null);
  const [pending] = useState(() => new Map<string, Promise<unknown>>());
  const ruleApply = useMemo(() => ruleApplyPort(mailEngine, pending), [mailEngine, pending]);

  const reload = useCallback(async () => {
    await reloadAccounts();
    if (engine) {
      setStats(await engine.storageStats());
      setIsDefault(await engine.isDefaultMailApp());
    }
  }, [reloadAccounts, engine]);

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
            const id = newItemId();
            const position = nextPosition(itemsOfKind(items, kind));
            const saved = mirror.upsert({ id, kind, value, position });
            pending.set(
              id,
              saved.catch(() => {}),
            );
            void saved.catch(fail("save that"));
            return id;
          },
          update: (item, value, position) => {
            if (!mirror) return;
            void mirror
              .upsert({ id: item.id, kind: item.kind, value, position: position ?? item.position })
              .catch(fail("save that"));
          },
          remove: (id) => void mirror?.remove(id).catch(fail("delete that")),
        }}
        ruleApply={ruleApply}
        accounts={accounts}
        accountActions={{
          reconnect: (id) => {
            const account = raw.find((r) => r.id === id) as MailAccount | undefined;
            if (account) setConnect({ reconnect: account });
          },
          syncNow: (id) =>
            after(email?.syncNow({ accountId: id }) ?? Promise.resolve(), "sync that account"),
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
      <ConnectSlot
        request={connect}
        onClose={() => {
          setConnect(null);
          void reload().catch(() => {});
        }}
      />
    </SettingsSectionShell>
  );
}
