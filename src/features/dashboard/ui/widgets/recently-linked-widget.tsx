// "Recently linked" dashboard widget (block CT-7, AC12 — the spine's DoD widget).
//
// The spine's one live dashboard surface: the workspace's most recent links,
// each row "<source> → <target> · <kind>", where clicking either end deep-links
// to that entity (the `moduo:entity:open` event the app chrome listens for).
// Neutral + tokens-only (R10): type icons distinguish entities, no per-type hue.
// `RecentlyLinkedList` is presentational; `RecentlyLinkedWidget` wires it to the
// runtime and degrades to a quiet empty state on any read error (a widget must
// never wall).

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { RELATION_KIND_LABELS } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { RecentLinkEndpoint, RecentLinkItem } from "@/features/spine/recent";
import { resolveEntityIcon } from "@/features/spine/icon-map";
import { cn } from "@/lib/utils";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

/** Open an entity's hub — the same gesture the EntityRefChip and notifications use. */
function openEntity(type: string, id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type, id } }));
}

function Endpoint({ end }: { end: RecentLinkEndpoint }) {
  const Icon = resolveEntityIcon(end.type, end.icon);
  return (
    <button
      type="button"
      disabled={end.tombstoned}
      onClick={() => openEntity(end.type, end.id)}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        end.tombstoned ? "opacity-60" : "hover:underline",
      )}
    >
      <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-foreground">{end.tombstoned ? `Deleted ${end.type}` : end.label}</span>
    </button>
  );
}

export function RecentlyLinkedList({ items }: { items: RecentLinkItem[] }) {
  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center px-4 text-center">
        <p className="text-sm text-muted-foreground">Nothing linked yet. Drag, @mention, or /ref to connect.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
        >
          <Endpoint end={item.source} />
          <ArrowRight className="size-icon-sm shrink-0 text-muted-foreground/70" aria-hidden />
          <Endpoint end={item.target} />
          <span className="ml-auto shrink-0 pl-2 text-2xs uppercase tracking-wide text-muted-foreground/70">
            {RELATION_KIND_LABELS[item.relationKind]}
          </span>
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

export function RecentlyLinkedWidget({ runtime, workspaceId, config }: Props) {
  const [items, setItems] = useState<RecentLinkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const recent = await runtime.spine.recentLinks({ workspaceId, limit: 20 });
        if (active) setItems(recent);
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
    <WidgetShell config={config} title="Recently linked" className="flex h-full flex-col bg-card">
      <div className="h-full overflow-y-auto">
        {loading ? (
          <div className="grid h-full place-items-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (
          <RecentlyLinkedList items={items} />
        )}
      </div>
    </WidgetShell>
  );
}
