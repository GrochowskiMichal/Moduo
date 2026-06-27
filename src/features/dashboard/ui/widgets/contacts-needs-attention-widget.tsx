// "Needs attention" dashboard widget (block CO-5, AC11 — the Contacts DoD
// widget). The light CRM's one live dashboard surface: contacts with an overdue
// follow-up, no recent touch, or a stale lead — each row deep-links to the hub
// (the `moduo:entity:open` event). Quiet by construction (R10, AC11): a neutral
// reason icon + muted detail text, NEVER a red guilt wall; color is never the
// only signal (icon + name + detail). `NeedsAttentionList` is presentational;
// the widget wires it to the runtime and degrades to a calm empty state.

import { useEffect, useState } from "react";
import { CalendarClock, Clock, UserMinus } from "lucide-react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import type { AttentionReason, NeedsAttentionItem } from "@/features/contacts/needs-attention";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

/** Open a contact's hub — the same gesture the directory and notifications use. */
function openContact(id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: "contact", id } }));
}

const REASON_ICON: Record<AttentionReason, typeof Clock> = {
  "overdue-followup": CalendarClock,
  "no-touch": Clock,
  "stale-lead": UserMinus,
};

export function NeedsAttentionList({ items }: { items: NeedsAttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center px-4 text-center">
        <p className="text-sm text-muted-foreground">Nothing needs attention. You’re on top of it.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {items.map((item) => {
        const Icon = REASON_ICON[item.reason];
        return (
          <li key={`${item.contactId}:${item.reason}`}>
            <button
              type="button"
              onClick={() => openContact(item.contactId)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
              <span className="shrink-0 pl-2 text-2xs text-muted-foreground">{item.detail}</span>
            </button>
          </li>
        );
      })}
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

export function ContactsNeedsAttentionWidget({ runtime, workspaceId, config }: Props) {
  const [items, setItems] = useState<NeedsAttentionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const next = await runtime.contacts.needsAttention({ workspaceId });
        if (active) setItems(next);
      } catch {
        // A widget must never wall — degrade to the quiet empty state.
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
    <WidgetShell config={config} title="Needs attention" className="flex h-full flex-col bg-card">
      <div className="h-full overflow-y-auto">
        {loading ? (
          <div className="grid h-full place-items-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (
          <NeedsAttentionList items={items} />
        )}
      </div>
    </WidgetShell>
  );
}
