import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Image, Modal, Pressable, Text, View } from "../tw";
import { useAuth } from "../providers/auth-provider";

type Props = {
  avatarDataUrl?: string | null;
  profileInitial?: string;
};

export function UserMenu({ avatarDataUrl, profileInitial = "U" }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <View className="relative flex-row items-center">
      <Pressable
        className="h-9 w-9 overflow-hidden rounded-full border border-[#2a2a2a] bg-[#0c0c0c] items-center justify-center"
        onPress={() => setMenuOpen((v: boolean) => !v)}
      >
        {avatarDataUrl ? (
          <Image source={{ uri: avatarDataUrl }} className="h-full w-full" contentFit="cover" />
        ) : (
          <Text className="text-[#f1f1f1] text-[13px] font-semibold">{profileInitial}</Text>
        )}
      </Pressable>
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable className="fixed inset-0" onPress={() => setMenuOpen(false)} />
        <View className="fixed top-16 right-5 bg-[#101318] border border-[#1e2430] rounded-xl py-1 min-w-[170px] z-[999]">
          <Pressable className="px-4 py-3" onPress={() => setMenuOpen(false)}>
            <Text className="text-[#d4d8e1]">Settings</Text>
          </Pressable>
          <Pressable
            className="px-4 py-3"
            onPress={async () => {
              setMenuOpen(false);
              try {
                await signOut();
              } finally {
                void navigate({ to: "/auth" });
              }
            }}
          >
            <Text className="text-[#d4d8e1]">Logout</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
