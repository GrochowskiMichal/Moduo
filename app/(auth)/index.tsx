import { useEffect } from "react";
import { router } from "expo-router";
import { Text, View } from "../../src/tw";
import { useAuth } from "../../src/providers/auth-provider";
import { EmailAuthPanel } from "../../src/components/auth/email-auth-panel";

export default function AuthScreen() {
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (isSignedIn) router.replace("/(app)");
  }, [isSignedIn]);

  return (
    <View className="flex-1 bg-[#050608]">
      <View className="flex-1 flex-row">
        <View className="flex-1 bg-[#04070f] justify-end p-8">
          <View className="absolute -top-20 -left-20 w-[300px] h-[300px] rounded-full bg-[#ffffff1f]" />
          <View className="absolute -bottom-[110px] -right-[70px] w-[260px] h-[260px] rounded-full bg-[#ffffff14]" />
          <Text className="text-[#98a2b3] text-xs">moduo</Text>
        </View>
        <View className="flex-1 items-center justify-center px-8 bg-[#05080f]">
          <EmailAuthPanel />
        </View>
      </View>
    </View>
  );
}
