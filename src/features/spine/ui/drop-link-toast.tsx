// Connective-tissue spine — drop-to-link orchestration + toast (block CT-3).
//
// `createLinkWithToast` is the one path a drop handler (or a keyboard "Link to…"
// action) calls: it persists the link via the CT-1 op with origin='drag', then
// raises a Sonner toast offering **Undo** and an inline **relation-kind
// override** (AC7). On failure it surfaces a quiet Retry — the link is never
// silently lost. The optimistic in-flight row is the consuming hub's job; this
// owns persistence + the confirmation affordance.

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";

import { UNDO_TOAST_MS } from "@/lib/undo-toast";
import {
  RELATION_KIND_LABELS,
  RELATION_KINDS,
  type EntityLink,
  type LinkOrigin,
  type RelationKind,
} from "@/lib/entity-links";
import {
  payloadRef,
  resolveKind,
  targetRef,
  type DragPayload,
  type DropLinkTarget,
} from "@/lib/drag-payload";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ToastArgs = {
  runtime: ModuoRuntime;
  workspaceId: string;
  link: EntityLink;
  sourceLabel: string;
  targetType: string;
  onChanged?: () => void;
};

function DropLinkToastCard({
  runtime,
  workspaceId,
  link,
  sourceLabel,
  targetType,
  onChanged,
  toastId,
}: ToastArgs & { toastId: string | number }) {
  const [kind, setKind] = useState<RelationKind>(link.relationKind);
  const [busy, setBusy] = useState(false);

  async function changeKind(next: RelationKind) {
    if (next === kind || busy) return;
    setBusy(true);
    try {
      await runtime.spine.setLinkKind({ workspaceId, linkId: link.id, relationKind: next });
      setKind(next);
      onChanged?.();
    } catch (err) {
      // e.g. the pair is already linked as `next` — surface it, keep the old kind.
      toast.error("Couldn’t change the relation", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (busy) return;
    setBusy(true);
    try {
      await runtime.spine.deleteLink({ workspaceId, linkId: link.id });
      onChanged?.();
      toast.dismiss(toastId); // dismiss only once the link is actually gone
    } catch (err) {
      // The link is never silently lost: keep the toast, report the failure.
      toast.error("Couldn’t undo the link", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md">
      <span className="min-w-0 flex-1 truncate">
        Linked <span className="font-medium">{sourceLabel}</span> → {targetType}{" "}
        <span className="text-muted-foreground">· {RELATION_KIND_LABELS[kind]}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={busy}>
            {RELATION_KIND_LABELS[kind]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {RELATION_KINDS.map((k) => (
            <DropdownMenuItem key={k} disabled={k === kind} onSelect={() => void changeKind(k)}>
              {RELATION_KIND_LABELS[k]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void undo()}>
        <Undo2 className="size-icon-sm" aria-hidden /> Undo
      </Button>
    </div>
  );
}

/** Raise the drop-to-link confirmation toast (Undo + relation-kind override). */
export function showDropLinkToast(args: ToastArgs) {
  toast.custom((id) => <DropLinkToastCard {...args} toastId={id} />, { duration: UNDO_TOAST_MS });
}

/**
 * Persist a drag-drop (or keyboard "Link to…") link with origin='drag' and show
 * the confirmation toast. Returns the created link, or null on failure (a quiet
 * Retry toast is shown). The relation kind is `resolveKind(source, target)`;
 * the user can override it from the toast or the hub row menu.
 */
export async function createLinkWithToast(args: {
  runtime: ModuoRuntime;
  workspaceId: string;
  source: DragPayload;
  target: DropLinkTarget;
  onChanged?: () => void;
  origin?: LinkOrigin;
}): Promise<EntityLink | null> {
  const { runtime, workspaceId, source, target, onChanged, origin = "drag" } = args;
  try {
    const link = await runtime.spine.createLink({
      workspaceId,
      source: payloadRef(source),
      target: targetRef(target),
      relationKind: resolveKind(source.entityType, target.entityType),
      origin,
      sourceLabel: source.label,
      sourceIcon: source.icon ?? null,
    });
    onChanged?.();
    showDropLinkToast({
      runtime,
      workspaceId,
      link,
      sourceLabel: source.label ?? source.entityType,
      targetType: target.entityType,
      onChanged,
    });
    return link;
  } catch (err) {
    toast.error("Couldn’t create the link", {
      description: err instanceof Error ? err.message : undefined,
      action: { label: "Retry", onClick: () => void createLinkWithToast(args) },
    });
    return null;
  }
}
