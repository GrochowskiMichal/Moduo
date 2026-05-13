/**
 * UpgradeModal — shown when a user tries to access a feature that requires a
 * higher plan tier.  Renders plan highlights and a CTA that opens Stripe Checkout.
 */

import { Modal, Pressable, Text, View } from "../tw";
import { useEntitlement, type FeatureGate } from "../hooks/use-entitlement";
import { Sparkles, X, Zap, Users } from "lucide-react";

type Props = {
  visible: boolean;
  feature: FeatureGate;
  onClose: () => void;
};

const FEATURE_LABELS: Record<FeatureGate, string> = {
  cloud_sync: "Cloud Sync",
  unlimited_workspaces: "Unlimited Workspaces",
  team_members: "Team Members",
  priority_support: "Priority Support",
  api_access: "API Access",
  advanced_analytics: "Advanced Analytics",
  custom_domain: "Custom Domain",
};

const PLAN_BULLETS: Record<"pro" | "team" | "founders", string[]> = {
  pro: [
    "Cloud sync across all your devices",
    "Unlimited workspaces",
    "Priority support",
    "API access",
    "Advanced analytics",
  ],
  team: [
    "Everything in Pro",
    "Unlimited team members",
    "Custom domain",
    "Team audit log",
    "SSO / SAML (coming soon)",
  ],
  founders: [
    "Everything in Pro forever",
    "Early access to new features",
    "Direct founder support",
    "Lifetime price lock",
  ],
};

export function UpgradeModal({ visible, feature, onClose }: Props) {
  const { planTier, requiredTier, upgrade } = useEntitlement(feature);

  const targetTier = requiredTier === "team" ? "team" : "pro";
  const bullets = PLAN_BULLETS[targetTier];
  const featureLabel = FEATURE_LABELS[feature];

  const handleUpgrade = () => {
    upgrade();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-4">
        <View className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-md p-6 gap-5">
          {/* Header */}
          <View className="flex-row items-start justify-between">
            <View className="flex-row items-center gap-2">
              {targetTier === "team" ? (
                <Users size={20} className="text-violet-400" />
              ) : (
                <Sparkles size={20} className="text-amber-400" />
              )}
              <Text className="text-white text-lg font-semibold">
                Upgrade to {targetTier === "team" ? "Team" : "Pro"}
              </Text>
            </View>
            <Pressable onPress={onClose} className="p-1 rounded-lg hover:bg-neutral-800">
              <X size={18} className="text-neutral-400" />
            </Pressable>
          </View>

          {/* Feature unlock message */}
          <View className="bg-neutral-800 rounded-xl px-4 py-3">
            <Text className="text-neutral-300 text-sm">
              <Text className="text-white font-medium">{featureLabel}</Text>
              {" "}requires a{" "}
              <Text className="font-medium" style={{ color: targetTier === "team" ? "#a78bfa" : "#fbbf24" }}>
                {targetTier === "team" ? "Team" : "Pro"}
              </Text>
              {" "}plan.
            </Text>
            {planTier !== "free" && (
              <Text className="text-neutral-500 text-xs mt-1">
                You're currently on the <Text className="text-neutral-300">{planTier}</Text> plan.
              </Text>
            )}
          </View>

          {/* Plan bullets */}
          <View className="gap-2">
            {bullets.map((bullet) => (
              <View key={bullet} className="flex-row items-center gap-2">
                <Zap size={14} className="text-amber-400 shrink-0" />
                <Text className="text-neutral-300 text-sm">{bullet}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <View className="gap-2">
            <Pressable
              onPress={handleUpgrade}
              className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 rounded-xl py-3 items-center"
            >
              <Text className="text-black font-semibold text-sm">
                Upgrade to {targetTier === "team" ? "Team" : "Pro"} →
              </Text>
            </Pressable>
            <Pressable onPress={onClose} className="py-2 items-center">
              <Text className="text-neutral-500 text-sm">Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
