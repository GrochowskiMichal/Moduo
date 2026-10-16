// Decisions on an item (chat-v2 §8, CH13, CH52; CV-14): "Decided with Mike ·
// Oct 12: we go with Stripe" for a decision in a direct message, "Decided in
// Acme · Oct 12: …" for one in a channel. Read through
// `chat_decisions_for_item`: the decisions of conversations linked to the item,
// and the ones that themselves refer to it in a conversation that mentions it,
// only from conversations the reader can read, for an item they can open.
// Nobody else learns a decision exists. A click opens the message in its
// conversation (and its chain beside it when it's a reply).

import { useContext, useEffect, useMemo, useState } from "react";

import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import { formatDate } from "@/lib/time-format";
import { useAuth } from "@/providers/auth-provider";
import { chatExcerptText } from "../spine/activity";
import { useReferences } from "../spine/references/context";
import { plainReferenceName, referencesInText } from "../spine/references/text";
import type { ReferenceRef } from "../spine/references/types";
import { WorkspaceContext } from "../workspaces/workspace-context";
import type { ChatItemDecision } from "./model";

/** "with Mike", "with Mike and Ana", "with Mike, Ana and 2 others"; "in Acme" for a channel. */
export function decidedWhere(
  row: Pick<ChatItemDecision, "channelKind" | "channelName" | "withNames">,
): string {
  if (row.channelKind === "channel") return `in ${row.channelName ?? "a channel"}`;
  const names = row.withNames;
  if (names.length === 0) return "in a direct message";
  if (names.length === 1) return `with ${names[0]}`;
  if (names.length === 2) return `with ${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `with ${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/** The line's lead: "Decided with Mike · Oct 12". */
export function decidedLead(
  row: Pick<ChatItemDecision, "channelKind" | "channelName" | "withNames" | "decisionAt">,
  now: Date = new Date(),
): string {
  return `Decided ${decidedWhere(row)} · ${formatDate(row.decisionAt, now)}`;
}

/** The item's decisions as the reader sees them (empty when chat is off for them). */
export function useItemDecisions(entityType: string, entityId: string): ChatItemDecision[] {
  const { runtime } = useAuth();
  const workspace = useContext(WorkspaceContext);
  const selectedWorkspaceId = workspace?.selectedWorkspaceId ?? null;
  const [rows, setRows] = useState<ChatItemDecision[]>([]);
  const canChat = !!workspace && workspace.modulePermissions.chat !== "none";

  useEffect(() => {
    setRows([]);
    if (!runtime?.chat || !canChat || !entityId) return;
    let live = true;
    const read = () =>
      runtime.chat
        ?.decisionsForItem(entityType, entityId)
        .then((list) => {
          if (live) setRows(list.filter((r) => r.workspaceId === selectedWorkspaceId));
        })
        .catch(() => {});
    void read();
    // Coming back to the window picks up decisions marked meanwhile.
    window.addEventListener("focus", read);
    return () => {
      live = false;
      window.removeEventListener("focus", read);
    };
  }, [runtime, canChat, entityType, entityId, selectedWorkspaceId]);

  return rows;
}

function openDecision(row: ChatItemDecision) {
  window.dispatchEvent(
    new CustomEvent(ENTITY_OPEN_EVENT, {
      detail: {
        type: "chat_channel",
        id: row.channelId,
        messageId: row.messageId,
        chainId: row.parentId,
      },
    }),
  );
}

const LINE =
  "flex min-w-0 items-center gap-1.5 rounded-sm text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The item's decisions, one quiet line each (nothing when there are none). */
export function DecisionLines({ entityType, entityId }: { entityType: string; entityId: string }) {
  const rows = useItemDecisions(entityType, entityId);
  // References inside the words read as names for this reader ("Private item"
  // when they can't open one), never as raw links.
  const refs = useMemo(() => {
    const seen = new Set<string>();
    const out: ReferenceRef[] = [];
    for (const r of rows) {
      for (const ref of referencesInText(r.excerpt)) {
        const key = `${ref.type}:${ref.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(ref);
        }
      }
    }
    return out;
  }, [rows]);
  const stateOf = useReferences(refs);
  if (rows.length === 0) return null;
  const now = new Date();
  const name = (ref: ReferenceRef) => plainReferenceName(ref, stateOf(ref));
  return (
    <ul data-slot="item-decisions" className="flex flex-col gap-0.5">
      {rows.map((r) => {
        const words = chatExcerptText(r.excerpt, name);
        return (
          <li key={r.messageId}>
            <button type="button" onClick={() => openDecision(r)} className={LINE}>
              <span className="truncate">
                {decidedLead(r, now)}
                {words ? `: ${words}` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
