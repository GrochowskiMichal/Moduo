import { Redirect, Slot, usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useAuth } from "../../src/providers/auth-provider";
import { Pressable, Text, View } from "../../src/tw";
import { UserMenu } from "../../src/components/user-menu";
import {
  dispatchNotesCreateKind,
  dispatchNotesFocusSearch,
  dispatchNotesToggleSidebar,
} from "../../src/features/notes/ui/layout-events";
import type { NoteKind } from "../../src/features/notes/types";

type TabItem = { label: string; icon: string; href: string };
const tabs: TabItem[] = [
  { label: "Dashboard", icon: "◫", href: "/" },
  { label: "Calendar", icon: "◻", href: "/calendar" },
  { label: "Notes", icon: "▤", href: "/notes" },
  { label: "Email", icon: "◎", href: "/email" },
  { label: "Tasks", icon: "☑", href: "/tasks" },
  { label: "Tags", icon: "◇", href: "/tags" },
];

const notesCreateActions: Array<{ label: string; kind: NoteKind; icon: string }> = [
  { label: "New Section", kind: "category", icon: "▣" },
  { label: "New Note Folder", kind: "folder", icon: "▢" },
  { label: "New Note", kind: "note", icon: "☰" },
];

export default function AppLayout() {
  const { isSignedIn, loading, userId, userEmail, supabase } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isNotesRoute = pathname === "/notes";
  const [profileLoading, setProfileLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [notesCreateMenuOpen, setNotesCreateMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;

    const syncProfile = async () => {
      if (!isSignedIn || !supabase || !userId) {
        if (active) setProfileLoading(false);
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
  }, [isSignedIn, supabase, userId, userEmail]);

  useEffect(() => {
    if (!isNotesRoute) setNotesCreateMenuOpen(false);
  }, [isNotesRoute]);

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
        {isNotesRoute && notesCreateMenuOpen ? (
          <View className="absolute bottom-[72px] rounded-2xl border border-[#1c2432] bg-[#0f131b] px-2 py-2 min-w-[320px]">
            {notesCreateActions.map((entry) => (
              <Pressable
                key={entry.kind}
                className="flex-row items-center justify-between px-3 py-3 rounded-lg"
                onPress={() => {
                  dispatchNotesCreateKind(entry.kind);
                  setNotesCreateMenuOpen(false);
                }}
              >
                <View className="flex-row items-center gap-3">
                  <Text className="text-[#f08f42] text-base">{entry.icon}</Text>
                  <Text className="text-[#cfd5e2] text-[18px]">{entry.label}</Text>
                </View>
                <Text className="text-[#a4acbd] text-2xl">+</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View className="flex-row items-center px-4 py-2 gap-8">
          <Pressable
            className="w-10 h-10 items-center justify-center"
            onPress={() => {
              if (!isNotesRoute) return;
              dispatchNotesToggleSidebar();
            }}
          >
            <Text className="text-[#8b93a3] text-2xl">◨</Text>
          </Pressable>
          <Pressable
            className="w-10 h-10 items-center justify-center"
            onPress={() => {
              if (!isNotesRoute) return;
              dispatchNotesFocusSearch();
            }}
          >
            <Text className="text-[#8b93a3] text-2xl">⌕</Text>
          </Pressable>
          <Pressable
            className={`w-10 h-10 items-center justify-center rounded-md ${isNotesRoute && notesCreateMenuOpen ? "bg-[#1b212d]" : "bg-[#11161f]"}`}
            onPress={() => {
              if (!isNotesRoute) return;
              setNotesCreateMenuOpen((current) => !current);
            }}
          >
            <Text className="text-[#cbd2df] text-[34px] -mt-1">+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
