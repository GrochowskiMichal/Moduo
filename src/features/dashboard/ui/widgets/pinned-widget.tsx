// DB-6 — "Pinned item" widget (S/M). Pin any registry entity (task/note/contact/
// event…) via the CT-4 MentionPicker (trigger 'ref'); the row deep-links into its
// module. The picked ref + label/icon are stored in config (updateConfig); a stale
// label is acceptable at alpha (DB-8 can add a live refresh).

import { Pencil, Pin } from "lucide-react";
import { useState } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { useMentionSearch } from "@/features/spine/hooks/use-mention-search";
import { resolveEntityIcon } from "@/features/spine/icon-map";
import { MentionPicker } from "@/features/spine/ui/mention-picker";
import { getRuntime } from "@/lib/runtime";

import { useDashboardData } from "../../context/dashboard-data-context";
import type { WidgetComponentProps } from "../../registry/types";
import { openEntity } from "../../widget-nav";

type Pinned = { type: string; id: string; label: string; icon: string | null };

function readPinned(config: Record<string, unknown>): Pinned | null {
  const p = config.pinned;
  if (!p || typeof p !== "object") return null;
  const rec = p as Record<string, unknown>;
  if (typeof rec.type !== "string" || typeof rec.id !== "string") return null;
  return {
    type: rec.type,
    id: rec.id,
    label: typeof rec.label === "string" ? rec.label : rec.type,
    icon: typeof rec.icon === "string" ? rec.icon : null,
  };
}

export function PinnedWidget({ widget, updateConfig }: WidgetComponentProps) {
  const { workspaceId } = useDashboardData();
  const [open, setOpen] = useState(false);
  const pinned = readPinned(widget.config);

  const search = useMentionSearch({
    runtime: getRuntime(),
    workspaceId,
    trigger: "ref",
    includePeople: false,
    enabled: open,
  });

  const picker = (trigger: React.ReactNode) => (
    <MentionPicker
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      candidates={search.candidates}
      query={search.query}
      onQueryChange={search.setQuery}
      loading={search.loading}
      placeholder="Pin a task, note, contact…"
      emptyLabel="No matches"
      onSelect={(candidate) => {
        if (candidate.kind === "entity") {
          updateConfig({
            pinned: {
              type: candidate.ref.type,
              id: candidate.ref.id,
              label: candidate.label,
              icon: candidate.icon,
            },
          });
        }
        setOpen(false);
      }}
    />
  );

  if (!pinned) {
    return (
      <div className="grid h-full place-items-center px-3 text-center">
        {picker(
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pin className="size-icon-sm" aria-hidden />
            Pin something
          </button>,
        )}
      </div>
    );
  }

  const Icon = resolveEntityIcon(pinned.type, pinned.icon);
  return (
    <div className="group relative flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
      {picker(
        <button
          type="button"
          aria-label="Change pinned item"
          className="absolute right-1.5 top-1.5 rounded-sm text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 hover:!text-foreground focus-visible:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil className="size-icon-xs" aria-hidden />
        </button>,
      )}
      <button
        type="button"
        onClick={() => openEntity(pinned.type, pinned.id)}
        className="flex max-w-full flex-col items-center gap-1.5 rounded-md p-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-icon-lg text-muted-foreground" aria-hidden />
        <span className="max-w-full truncate text-sm font-medium text-foreground">
          {pinned.label}
        </span>
        <Eyebrow tone="tag">{pinned.type}</Eyebrow>
      </button>
    </div>
  );
}
