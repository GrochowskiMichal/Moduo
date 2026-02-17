import { Redirect, Slot, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { useAuth } from "../../src/providers/auth-provider";
import { WorkspaceProvider } from "../../src/providers/workspace-provider";
import { View } from "../../src/tw";
import { AppChrome } from "../../src/components/app/app-chrome";

export default function AppLayout() {
  const { isSignedIn, loading, userId, userEmail, supabase } = useAuth();
  const pathname = usePathname();
  const [profileLoading, setProfileLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [profileInitial, setProfileInitial] = useState("M");

  useEffect(() => {
    let active = true;

    const syncProfile = async () => {
      if (!isSignedIn || !supabase || !userId) {
        if (active) {
          setProfileLoading(false);
          setProfileInitial((userEmail?.[0] ?? "M").toUpperCase());
        }
        return;
      }

      try {
        const { data: current, error: selectError } = await supabase
          .from("users")
          .select("id,email,first_name,last_name,onboarding_completed")
          .eq("id", userId)
          .maybeSingle();
        if (selectError) throw selectError;

        let nextNeedsOnboarding = false;
        if (!current) {
          const { error: upsertError } = await supabase.from("users").upsert(
            {
              id: userId,
              email: userEmail,
              onboarding_completed: false,
            },
            { onConflict: "id" }
          );
          if (upsertError) throw upsertError;
          nextNeedsOnboarding = true;
          if (active) setProfileInitial((userEmail?.[0] ?? "M").toUpperCase());
        } else {
          const hasStoredNames = !!(current.first_name?.trim() && current.last_name?.trim());
          nextNeedsOnboarding = !(current.onboarding_completed || hasStoredNames);

          if (!current.email && userEmail) {
            const { error: updateError } = await supabase
              .from("users")
              .update({ email: userEmail })
              .eq("id", userId);
            if (updateError) throw updateError;
          }

          const initialSource =
            current.first_name?.trim() ||
            current.last_name?.trim() ||
            current.email?.trim() ||
            userEmail ||
            "M";
          if (active) setProfileInitial(initialSource[0].toUpperCase());
        }

        if (active) setNeedsOnboarding(nextNeedsOnboarding);
      } catch {
        if (active) {
          setNeedsOnboarding(false);
          setProfileInitial((userEmail?.[0] ?? "M").toUpperCase());
        }
      } finally {
        if (active) setProfileLoading(false);
      }
    };

    void syncProfile();
    return () => {
      active = false;
    };
  }, [isSignedIn, supabase, userId, userEmail]);

  if (loading) return null;
  if (!loading && !isSignedIn) return <Redirect href="/(auth)" />;
  if (profileLoading) return null;
  if (needsOnboarding && pathname !== "/onboarding") return <Redirect href="/onboarding" />;
  if (!needsOnboarding && pathname === "/onboarding") return <Redirect href="/" />;

  if (pathname === "/onboarding") {
    return (
      <View className="flex-1 bg-[#060606]">
        <Slot />
      </View>
    );
  }

  return (
    <WorkspaceProvider>
      <AppChrome profileInitial={profileInitial} />
    </WorkspaceProvider>
  );
}
