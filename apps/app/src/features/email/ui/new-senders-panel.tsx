// New senders (Screener, X1 / AC27): each first-time sender with Allow and
// Block. Block adds them to the blocked senders list (Settings → Mail, AC28);
// Allow records a screener decision; both release their threads from the view.

import { Button } from "@/components/ui/button";
import { getRuntime } from "@/lib/runtime";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import type { MailCommands } from "../commands/triage";

export type NewSender = { address: string; name: string; threadIds: string[] };
export type SenderDecision = "allow" | "block";

/** Saves a screener decision or a blocked sender as a synced settings item. */
export async function saveSenderSetting(
  kind: "blocked_sender" | "screener_decision",
  value: Record<string, unknown>,
): Promise<unknown> {
  const email = getRuntime()?.email;
  if (!email) throw new Error("Settings aren't available");
  return email.upsertSetting({ id: crypto.randomUUID(), kind, value });
}

/** One entry per sender address (lowercased), in first-seen order. */
export function groupNewSenders(rows: readonly MailThreadRow[]): NewSender[] {
  const by = new Map<string, NewSender>();
  for (const r of rows) {
    const s = r.senders[0];
    if (!s?.email) continue;
    const address = s.email.trim().toLowerCase();
    const have = by.get(address);
    if (have) have.threadIds.push(r.threadId);
    else by.set(address, { address, name: s.name || address, threadIds: [r.threadId] });
  }
  return [...by.values()];
}

/** Save the decision as a settings item, then release the sender's threads. */
export async function decideNewSender(
  sender: NewSender,
  decision: SenderDecision,
  deps: {
    commands: Pick<MailCommands, "releaseNewSenders">;
    save: (
      kind: "blocked_sender" | "screener_decision",
      value: Record<string, unknown>,
    ) => Promise<unknown>;
  },
): Promise<void> {
  if (decision === "block") await deps.save("blocked_sender", { address: sender.address });
  else await deps.save("screener_decision", { address: sender.address, decision: "allow" });
  await deps.commands.releaseNewSenders(sender.threadIds);
}

export function NewSendersPanel({
  rows,
  onDecide,
  openThreadId = null,
}: {
  rows: readonly MailThreadRow[];
  onDecide: (sender: NewSender, decision: SenderDecision) => Promise<void> | void;
  /** The open thread's sender is decided in the reader's sender header, not here
   *  (specs/mail-improve.md §5, AC24). */
  openThreadId?: string | null;
}) {
  const senders = groupNewSenders(rows);
  if (senders.length === 0) return null;
  return (
    <ul aria-label="New senders" className="mx-2 mb-1 flex flex-col gap-1">
      {senders.map((s) => (
        <li key={s.address} className="flex items-center gap-2 px-1 text-sm">
          <span className="min-w-0 flex-1 truncate" title={s.address}>
            {s.name}
            <span className="ml-1 text-xs text-muted-foreground">{s.threadIds.length}</span>
          </span>
          {openThreadId && s.threadIds.includes(openThreadId) ? (
            <span className="text-xs text-muted-foreground">Decide in the reader</span>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Allow ${s.name}`}
                onClick={() => void Promise.resolve(onDecide(s, "allow")).catch(() => {})}
              >
                Allow
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Block ${s.name}`}
                onClick={() => void Promise.resolve(onDecide(s, "block")).catch(() => {})}
              >
                Block
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
