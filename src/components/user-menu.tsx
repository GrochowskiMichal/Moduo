import { useState } from "react";
import { Modal } from "react-native";
import { useRouter } from "expo-router";
import { Image, Pressable, Text, View } from "../tw";
import { useAuth } from "../providers/auth-provider";

export function UserMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut } = useAuth();
  const router = useRouter();

  return (
    <View className="relative flex-row items-center gap-2">
      <Image
        source={require("../../assets/moduo_favicon.png")}
        className="w-9 h-9"
        contentFit="contain"
      />
      <Pressable
        className="w-8 h-8 rounded-md items-center justify-center"
        onPress={() => setMenuOpen((v: boolean) => !v)}
      >
        <Text className="text-[#9aa2b1] text-sm">▾</Text>
      </Pressable>
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable className="flex-1" onPress={() => setMenuOpen(false)} />
        <View className="absolute top-16 left-8 bg-[#101318] border border-[#1e2430] rounded-xl py-1 min-w-[170px] z-[999]">
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
                router.replace("/(auth)");
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
