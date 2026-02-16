import { Redirect } from "expo-router";
import { ActivityIndicator } from "react-native";
import { View } from "@tamagui/core";
import { useAuth } from "../src/providers/auth-provider";

export default function IndexRoute() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View flex={1} alignItems="center" justifyContent="center" backgroundColor="#f6f7fb">
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={session ? "/(app)" : "/(auth)"} />;
}
