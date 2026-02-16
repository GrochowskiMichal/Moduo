import { Stack } from "expo-router";
import { Redirect } from "expo-router";
import { useAuth } from "../../src/providers/auth-provider";

export default function AuthLayout() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!loading && session) return <Redirect href="/(app)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
