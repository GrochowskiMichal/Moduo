import { Redirect } from "expo-router";
import { ActivityIndicator } from "react-native";
import { View } from "../src/tw";
import { useAuth } from "../src/providers/auth-provider";

export default function IndexRoute() {
  const { isSignedIn, loading } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#f6f7fb]">
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={isSignedIn ? "/(app)" : "/(auth)"} />;
}
