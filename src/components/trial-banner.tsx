/**
 * TrialBanner — shown inside AppChrome for users on a trialing subscription.
 * Reads the user_entitlements view to show remaining trial days and a CTA.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Clock, X } from "lucide-react";
import { Pressable, Text, View } from "../tw";
import { useAuth } from "../providers/auth-provider";

type Entitlements = {
  subscription_status: string | null;
  trial_days_remaining: number | null;
};

const DISMISSED_KEY = "moduo:trial_banner_dismissed";

export function TrialBanner() {
  const { accessToken, isSignedIn, runtime } = useAuth();
  const navigate = useNavigate();
  const isWeb = !!runtime?.capabilities.isWeb;

  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISSED_KEY) === "1";
  });

  useEffect(() => {
    if (!isSignedIn || !accessToken) return;

    const supabaseUrl =
      (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
      "https://wtoonrvuqumihpkbvwvs.supabase.co";
    const anonKey = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined) || "";

    fetch(
      `${supabaseUrl}/rest/v1/user_entitlements?select=subscription_status,trial_days_remaining`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
        },
      }
    )
      .then((r) => r.json())
      .then((rows: Entitlements[]) => {
        if (Array.isArray(rows) && rows.length > 0) {
          setEntitlements(rows[0]);
        }
      })
      .catch(() => {});
  }, [isSignedIn, accessToken]);

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DISMISSED_KEY, "1");
    }
    setDismissed(true);
  };

  const handleCta = () => {
    void navigate({ to: "/settings", search: { section: "billing" } });
  };

  if (
    dismissed ||
    !entitlements ||
    entitlements.subscription_status !== "trialing" ||
    entitlements.trial_days_remaining === null
  ) {
    return null;
  }

  const days = Math.ceil(entitlements.trial_days_remaining);
  const isUrgent = days <= 2;

  return (
    <View
      className={`flex flex-row items-center gap-3 px-5 py-2 ${
        isUrgent ? "bg-red-950/60" : "bg-amber-950/50"
      }`}
    >
      <Clock size={13} color={isUrgent ? "#fca5a5" : "#fcd34d"} />
      <Text className={`flex-1 text-[12px] leading-4 ${isUrgent ? "text-red-200" : "text-amber-200"}`}>
        {days <= 0
          ? "Your trial has expired."
          : `${days} day${days === 1 ? "" : "s"} left in your trial.`}{" "}
        {isWeb && (
          <Pressable onPress={handleCta} className="inline">
            <Text className={`text-[12px] font-medium underline ${isUrgent ? "text-red-100" : "text-amber-100"}`}>
              Add a card to extend to 30 days →
            </Text>
          </Pressable>
        )}
      </Text>
      <Pressable onPress={handleDismiss} className="p-1">
        <X size={12} color={isUrgent ? "#fca5a5" : "#fcd34d"} />
      </Pressable>
    </View>
  );
}
