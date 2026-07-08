// "Recent notes" dashboard widget (block NO-10, AC13 — the Notes module DoD widget).
//
// The workspace's most recently-touched notes (by anyone), each a snippet row
// that deep-links to the note (the `moduo:entity:open` event the app chrome
// listens for → /notes?id). Tokens-only. `RecentNotesList` is presentational;
// `RecentNotesWidget` wires it to the runtime and degrades to a quiet empty
// state on any read error (a widget must never wall). Distinct from the legacy
// "notes" preview widget, which stays untouched until the dashboard rework.

import { useEffect, useState } from "react";
import { FileText, Globe } from "lucide-react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { shapeRecentNotes, type RecentNoteItem } from "@/features/notes/recent";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

/** Open a note's hub — the same gesture chips + notifications use. */
function openNote(id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("moduo:entity:open", { detail: { type: "note", id } }));
}

export function RecentNotesList({ items }: { items: RecentNoteItem[] }) {
  if (items.length === 0) {
    return (
      <div className="grid h-full place-items-center px-4 text-center">
        <p className="text-sm text-muted-foreground">No notes yet. Press ⌘⇧N to capture one.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => openNote(item.id)}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText className="mt-0.5 size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-sm text-foreground">{item.title}</span>
                {item.isPublished ? (
                  <Globe className="size-3 shrink-0 text-primary" aria-label="Published" />
                ) : null}
              </span>
              {item.snippet ? (
                <span className="truncate text-xs text-muted-foreground">{item.snippet}</span>
              ) : null}
            </span>
            <span className="shrink-0 pl-2 pt-0.5 text-2xs text-muted-foreground/70">{item.touchedLabel}</span>
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

export function RecentNotesWidget({ runtime, workspaceId, config }: Props) {
  const [items, setItems] = useState<RecentNoteItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const rows = await runtime.notesV2.recent({ workspaceId, limit: 12 });
        if (active) setItems(shapeRecentNotes(rows, { limit: 8, now: new Date() }));
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
    <WidgetShell config={config} title="Recent notes" className="flex h-full flex-col bg-card">
      <div className="h-full overflow-y-auto">
        {loading ? (
          <div className="grid h-full place-items-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (
          <RecentNotesList items={items} />
        )}
      </div>
    </WidgetShell>
  );
}
