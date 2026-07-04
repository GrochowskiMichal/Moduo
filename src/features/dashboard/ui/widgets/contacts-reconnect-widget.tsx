// "Reconnect" dashboard widget (specs/contacts-v2.md, Batch 4 delighter). People
// you've gone quiet on — oldest last-touch first — a gentle nudge to reach out
// (Clay/Dex's loved "happy serendipity"), derived from the spine, never a guilt
// wall. Quiet: a clock icon + muted "N days ago"; each row deep-links to the hub.

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import type { ReconnectItem } from "@/features/contacts/reconnect";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

function openContact(id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: "contact", id } }));
}

function ago(item: ReconnectItem): string {
  if (item.daysSince == null) return "no recent contact";
  if (item.daysSince < 1) return "today";
  return `${item.daysSince} ${item.daysSince === 1 ? "day" : "days"} ago`;
}

export function ReconnectList({ items }: { items: ReconnectItem[] }) {
  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center px-4 text-center">
        <p className="text-sm text-muted-foreground">You’re in touch with everyone. Nice.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {items.map((item) => (
        <li key={item.contactId}>
          <button
            type="button"
            onClick={() => openContact(item.contactId)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Clock className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
            <span className="shrink-0 pl-2 text-2xs text-muted-foreground">{ago(item)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function ContactsReconnectWidget({ runtime, workspaceId, config }: Props) {
  const [items, setItems] = useState<ReconnectItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const next = await runtime.contacts.reconnect({ workspaceId });
        if (active) setItems(next);
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId]);

  return (
    <WidgetShell config={config} title="Reconnect" className="flex h-full flex-col bg-card">
      <div className="h-full overflow-y-auto">
        {loading ? (
          <div className="grid h-full place-items-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (
          <ReconnectList items={items} />
        )}
      </div>
    </WidgetShell>
  );
}
