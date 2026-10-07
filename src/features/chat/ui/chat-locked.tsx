// Shown when this workspace's plan doesn't include chat (owner below Duo).
// Teaches what chat is in Moduo (the moat: talk next to the work, link anything
// with #) and offers the one upgrade that unlocks it. One primary action (R5).

import { planHasChat } from "@contracts/vocabularies";
import { AtSign, BellOff, Hash, MessagesSquare, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startCheckout } from "@/features/billing/checkout";
import { planCard } from "@/features/billing/plans";
import { openStripeUrl } from "@/features/billing/stripe-url";
import { useAuth } from "@/providers/auth-provider";

const POINTS = [
  {
    icon: Hash,
    title: "Channels, DMs and threads",
    body: "Topic channels, private rooms and direct messages — replies stay in threads, not on top of each other.",
  },
  {
    icon: Zap,
    title: "Linked to the work",
    body: "Type # to drop a live task, note, event or contact into a message. Turn any message into a task.",
  },
  {
    icon: BellOff,
    title: "Quiet by default",
    body: "Only DMs, @mentions and your threads ping you. Every channel can be set to all, mentions or mute.",
  },
  {
    icon: AtSign,
    title: "Real time",
    body: "Messages, reactions, typing and who's around update live on web and desktop.",
  },
];

export function ChatLocked({ isOwner }: { isOwner: boolean }) {
  const { planTier, accessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const duo = planCard("duo");
  const ownPlanHasChat = planHasChat(planTier);

  const upgrade = async () => {
    setBusy(true);
    try {
      await startCheckout({ accessToken, plan: "duo" });
    } catch {
      toast("Couldn't open checkout — opening plans instead.");
      void openStripeUrl("https://moduo.app/#pricing");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="grid size-10 place-items-center rounded-lg border border-border bg-background">
            <MessagesSquare className="size-icon text-foreground" aria-hidden />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Talk where the work lives
          </h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Chat comes with the Duo and Team plans. Conversations sit next to your tasks, notes and
            calendar — so the decision and the thing it's about are one click apart.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3.5"
            >
              <Icon className="size-icon-sm text-muted-foreground" aria-hidden />
              <span className="font-display text-sm font-medium text-foreground">{title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
            </li>
          ))}
        </ul>

        {isOwner ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => void upgrade()} disabled={busy}>
              {busy ? "Opening checkout…" : `Upgrade to Duo — $${duo?.monthly ?? 20}/mo for two`}
            </Button>
            <span className="text-xs text-muted-foreground">Team plans start at three seats.</span>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-background p-3.5 text-sm text-muted-foreground">
            {ownPlanHasChat
              ? "Your plan includes chat, but this workspace belongs to someone on a plan without it. Switch to one of your workspaces, or ask the owner to upgrade."
              : "Ask the owner of this workspace to move to the Duo or Team plan to turn chat on for everyone here."}
          </p>
        )}
      </div>
    </div>
  );
}
