import { Redirect, Slot, usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-expo";
import { useAuth } from "../../src/providers/auth-provider";
import { Pressable, Text, View } from "../../src/tw";
import { UserMenu } from "../../src/components/user-menu";

type TabItem = { label: string; icon: string; href: string };
const tabs: TabItem[] = [
  { label: "Dashboard", icon: "◫", href: "/" },
  { label: "Calendar", icon: "◻", href: "/calendar" },
  { label: "Notes", icon: "▤", href: "/notes" },
  { label: "Email", icon: "◎", href: "/email" },
  { label: "Tasks", icon: "☑", href: "/tasks" },
  { label: "Tags", icon: "◇", href: "/tags" },
];

export default function AppLayout() {
  const { isSignedIn, loading, userId, supabase } = useAuth();
  const { user, isLoaded: clerkLoaded } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [profileLoading, setProfileLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    let active = true;

    const syncProfile = async () => {
      if (!isSignedIn || !supabase || !userId || !clerkLoaded) {
        if (active) setProfileLoading(false);
        return;
      }

      try {
        const primaryEmail = user?.primaryEmailAddress?.emailAddress ?? null;
        const providerFirstName = user?.firstName?.trim() || null;
        const providerLastName = user?.lastName?.trim() || null;
        const hasProviderNames = !!(providerFirstName && providerLastName);

        if (primaryEmail) {
          await supabase.rpc("sync_clerk_user", {
            p_clerk_user_id: userId,
            p_email: primaryEmail,
            p_first_name: providerFirstName,
            p_last_name: providerLastName,
            p_onboarding_completed: hasProviderNames,
          });
        }

        const { data: current, error: selectError } = await supabase
          .from("users")
          .select("id,email,first_name,last_name,onboarding_completed")
          .eq("id", userId)
          .maybeSingle();
        if (selectError) throw selectError;

        let nextNeedsOnboarding = true;
        if (current) {
          const hasStoredNames = !!(current.first_name?.trim() && current.last_name?.trim());
          nextNeedsOnboarding = !(current.onboarding_completed || hasStoredNames || hasProviderNames);

          const patch: Record<string, unknown> = {};
          if (!current.email && primaryEmail) patch.email = primaryEmail;
          if (!hasStoredNames && hasProviderNames) {
            patch.first_name = providerFirstName;
            patch.last_name = providerLastName;
            patch.onboarding_completed = true;
            nextNeedsOnboarding = false;
          }
          if (Object.keys(patch).length > 0) {
            const { error: updateError } = await supabase.from("users").update(patch).eq("id", userId);
            if (updateError) throw updateError;
          }
        }

        if (active) setNeedsOnboarding(nextNeedsOnboarding);
      } catch {
        if (active) setNeedsOnboarding(false);
      } finally {
        if (active) setProfileLoading(false);
      }
    };

    syncProfile();
    return () => {
      active = false;
    };
  }, [isSignedIn, supabase, userId, clerkLoaded, user]);

  if (loading) return null;
  if (!loading && !isSignedIn) return <Redirect href="/(auth)" />;
  if (profileLoading) return null;
  if (needsOnboarding && pathname !== "/onboarding") return <Redirect href="/onboarding" />;
  if (!needsOnboarding && pathname === "/onboarding") return <Redirect href="/" />;

  const onOnboardingRoute = pathname === "/onboarding";
  if (onOnboardingRoute) {
    return (
      <View className="flex-1 bg-[#050608]">
        <Slot />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#050608]">
      <View className="flex-row items-center justify-between px-8 pt-5">
        <UserMenu />
        <View className="flex-row items-center gap-1">
          {tabs.map((tab) => {
            const active = pathname === tab.href || (tab.href === "/" && pathname === "");
            return (
              <Pressable
                key={tab.label}
                className={`rounded-lg px-3 py-2 flex-row items-center gap-2 ${active ? "bg-[#171a21]" : ""}`}
                onPress={() => router.replace(tab.href as any)}
              >
                <Text className={`${active ? "text-white" : "text-[#7d8595]"} text-xs`}>{tab.icon}</Text>
                <Text className={`${active ? "text-white" : "text-[#7d8595]"} text-[18px]`}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View className="w-10 h-10" />
      </View>

      <View className="flex-1">
        <Slot />
      </View>

      <View className="items-center pb-5">
        <View className="flex-row items-center px-4 py-2 gap-8">
          <Text className="text-[#8b93a3] text-2xl">🪐</Text>
          <Text className="text-[#8b93a3] text-2xl">⌕</Text>
          <Text className="text-[#8b93a3] text-[34px] -mt-1">+</Text>
        </View>
      </View>
    </View>
  );
}
