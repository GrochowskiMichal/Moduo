// The local mirror of mail settings items (MR-7, specs/mail-rebuild.md
// decision 16): what the engine and the UI read for rules, tabs, Priority
// people, blocks, Screener decisions, overrides, snippets, aliases and saved
// searches. It pulls rows changed since its high-water mark (tombstones
// included), merges per row by `updatedAt` (last writer wins), and caches per
// user in storage for instant first paint. Refresh on change and on focus:
// `startEmailSettingsMirror` wires the focus listener.

import type { EmailSettingsKind } from "@contracts/vocabularies";

import { getRuntime } from "@/lib/runtime";
import type { EmailRuntime, EmailSettingsItem } from "@/lib/runtime.types.email";

export type EmailSettingsPort = Pick<
  EmailRuntime,
  "listSettings" | "upsertSetting" | "deleteSetting"
>;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type Cache = { mark: string | null; items: EmailSettingsItem[] };

const cacheKey = (userId: string) => `moduo:email-settings:v1:${userId}`;

function readCache(storage: StorageLike | null, userId: string): Cache {
  try {
    const raw = storage?.getItem(cacheKey(userId));
    if (!raw) return { mark: null, items: [] };
    const parsed = JSON.parse(raw) as Partial<Cache>;
    return {
      mark: typeof parsed.mark === "string" ? parsed.mark : null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { mark: null, items: [] };
  }
}

export type EmailSettingsMirror = ReturnType<typeof createEmailSettingsMirror>;

export function createEmailSettingsMirror(opts: {
  port: EmailSettingsPort;
  storage: StorageLike | null;
  userId: string;
}) {
  const { port, storage, userId } = opts;
  const cached = readCache(storage, userId);
  const rows = new Map<string, EmailSettingsItem>(cached.items.map((i) => [i.id, i]));
  let mark = cached.mark;
  let snapshot: EmailSettingsItem[] = [];
  const listeners = new Set<() => void>();

  function rebuild() {
    snapshot = [...rows.values()]
      .filter((r) => r.deletedAt === null)
      .sort((a, b) => a.position - b.position || a.updatedAt.localeCompare(b.updatedAt));
  }

  function persist() {
    try {
      storage?.setItem(cacheKey(userId), JSON.stringify({ mark, items: [...rows.values()] }));
    } catch {
      /* quota or storage disabled: the mirror still works in memory */
    }
  }

  function apply(incoming: EmailSettingsItem[]) {
    let changed = false;
    for (const row of incoming) {
      const have = rows.get(row.id);
      if (have && have.updatedAt > row.updatedAt) continue;
      rows.set(row.id, row);
      if (!mark || row.updatedAt > mark) mark = row.updatedAt;
      changed = true;
    }
    if (!changed) return;
    rebuild();
    persist();
    for (const l of listeners) l();
  }

  rebuild();

  return {
    items: () => snapshot,
    byKind: (kind: EmailSettingsKind) => snapshot.filter((i) => i.kind === kind),
    /** The newest live sender override for an address (two devices may each have minted one). */
    senderOverride(address: string) {
      const key = address.trim().toLowerCase();
      let best: EmailSettingsItem | null = null;
      for (const i of snapshot) {
        if (i.kind !== "sender_override") continue;
        const a = i.value.address;
        if (typeof a !== "string" || a.toLowerCase() !== key) continue;
        if (!best || i.updatedAt > best.updatedAt) best = i;
      }
      return best;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    apply,
    /** Pull changes; false (keeping what it had) when the read fails. */
    async refresh(): Promise<boolean> {
      try {
        apply(await port.listSettings({ since: mark }));
        return true;
      } catch {
        return false;
      }
    },
    async upsert(input: Parameters<EmailSettingsPort["upsertSetting"]>[0]) {
      const row = await port.upsertSetting(input);
      apply([row]);
      return row;
    },
    async remove(id: string) {
      const ok = await port.deleteSetting({ id });
      const have = rows.get(id);
      if (ok && have) {
        const now = new Date().toISOString();
        apply([
          { ...have, deletedAt: now, updatedAt: now > have.updatedAt ? now : have.updatedAt },
        ]);
      }
      return ok;
    },
  };
}

/** Builds the mirror on the runtime and refreshes it now and whenever the window regains focus. */
export function startEmailSettingsMirror(
  userId: string,
): { mirror: EmailSettingsMirror; stop: () => void } | null {
  const runtime = getRuntime();
  if (!runtime) return null;
  let storage: StorageLike | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    storage = null;
  }
  const mirror = createEmailSettingsMirror({ port: runtime.email, storage, userId });
  void mirror.refresh();
  if (typeof window === "undefined") return { mirror, stop: () => {} };
  const onFocus = () => void mirror.refresh();
  window.addEventListener("focus", onFocus);
  return { mirror, stop: () => window.removeEventListener("focus", onFocus) };
}
