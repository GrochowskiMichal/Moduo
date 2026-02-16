import { Stack } from "expo-router";
import { Redirect } from "expo-router";
import { useAuth } from "../../src/providers/auth-provider";

export default function AppLayout() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!loading && !session) return <Redirect href="/(auth)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
