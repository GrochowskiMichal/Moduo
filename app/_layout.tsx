import { Slot } from "expo-router";
import { TamaguiProvider } from "@tamagui/core";
import { AuthProvider } from "../src/providers/auth-provider";
import tamaguiConfig from "../tamagui.config";

export default function RootLayout() {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
      <AuthProvider>
        <Slot />
      </AuthProvider>
    </TamaguiProvider>
  );
}
