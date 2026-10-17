import { Sparkles, Users, Zap } from "lucide-react";
import { PLAN_CARDS } from "../features/billing/plans";
import { type FeatureGate, useEntitlement } from "../hooks/use-entitlement";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

type Props = {
  visible: boolean;
  feature: FeatureGate;
  onClose: () => void;
};

const FEATURE_LABELS: Record<FeatureGate, string> = {
  cloud_sync: "Cloud Sync",
  unlimited_workspaces: "Unlimited Workspaces",
  team_members: "Team Members",
  shared_workspaces: "Shared Workspaces",
  priority_support: "Priority Support",
  api_access: "API Access",
  advanced_analytics: "Advanced Analytics",
  custom_domain: "Custom Domain",
};

const TARGET_BULLETS: Record<"pro" | "duo" | "team", string[]> = {
  pro: PLAN_CARDS[1].features,
  duo: PLAN_CARDS[2].features,
  team: PLAN_CARDS[3].features,
};

/**
 * UpgradeModal — shown when a user tries to use a feature gated to a higher
 * plan tier. Reads the gate via useEntitlement, lists what the target tier
 * unlocks, and opens Stripe Checkout via `upgrade()` when the user confirms.
 */
export function UpgradeModal({ visible, feature, onClose }: Props) {
  const { planTier, requiredTier, upgrade } = useEntitlement(feature);

  const targetTier = requiredTier === "team" ? "team" : requiredTier === "duo" ? "duo" : "pro";
  const bullets = TARGET_BULLETS[targetTier];
  const featureLabel = FEATURE_LABELS[feature];
  const TierIcon = targetTier === "team" ? Users : Sparkles;
  const tierLabel = targetTier === "team" ? "Team" : targetTier === "duo" ? "Duo" : "Pro";

  const handleUpgrade = () => {
    upgrade();
    onClose();
  };

  return (
    <Dialog
      open={visible}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TierIcon className="size-5 text-primary" aria-hidden />
            Upgrade to {tierLabel}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{featureLabel}</span> requires the{" "}
            <span className="font-medium text-foreground">{tierLabel}</span> plan.
          </DialogDescription>
        </DialogHeader>

        {planTier !== "free" ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            You&apos;re currently on the <span className="text-foreground">{planTier}</span> plan.
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2 text-sm text-foreground">
              <Zap className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <Button onClick={handleUpgrade} size="lg">
            Upgrade to {tierLabel}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
