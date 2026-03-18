import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Image, Modal, Pressable, Text, View } from "../tw";
import { useAuth } from "../providers/auth-provider";

type Props = {
  avatarDataUrl?: string | null;
  profileInitial?: string;
  onOpenSettings?: () => void;
  onOpenIntegrations?: () => void;
};

export function UserMenu({ avatarDataUrl, profileInitial = "U", onOpenSettings, onOpenIntegrations }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <View className="relative flex-row items-center">
      <Pressable
        className="relative h-9 w-9 overflow-hidden rounded-full border border-[#2a2a2a] bg-[#0c0c0c] items-center justify-center"
        onPress={() => setMenuOpen((v: boolean) => !v)}
      >
        {avatarDataUrl ? (
          <Image source={{ uri: avatarDataUrl }} className="h-full w-full" contentFit="cover" />
        ) : (
          <View className="absolute inset-0 flex items-center justify-center">
            <Text className="text-center text-[13px] font-semibold leading-none text-[#f1f1f1]">{profileInitial}</Text>
          </View>
        )}
      </Pressable>
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable className="fixed inset-0" onPress={() => setMenuOpen(false)} />
        <View className="fixed right-5 top-16 z-[999] w-[240px] rounded-xl bg-[#171717] p-2">
          <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1">
            <Text className="text-xs text-[#a0a0a0]">Account</Text>
          </View>
          <Pressable
            className="rounded-lg px-3 py-2 hover:bg-[#1f1f1f]"
            onPress={() => {
              setMenuOpen(false);
              onOpenSettings?.();
            }}
          >
            <Text className="text-[14px] text-[#d9d9d9]">Settings</Text>
          </Pressable>
          <Pressable
            className="rounded-lg px-3 py-2 hover:bg-[#1f1f1f]"
            onPress={() => {
              setMenuOpen(false);
              onOpenIntegrations?.();
            }}
          >
            <Text className="text-[14px] text-[#d9d9d9]">Integrations</Text>
          </Pressable>
          <Pressable
            className="rounded-lg px-3 py-2 hover:bg-[#1f1f1f]"
            onPress={async () => {
              setMenuOpen(false);
              try {
                await signOut();
              } finally {
                void navigate({ to: "/auth" });
              }
            }}
          >
            <Text className="text-[14px] text-[#d9d9d9]">Logout</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
