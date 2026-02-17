import { Platform } from "react-native";
import { Image, Text, View } from "../../tw";

export function ClerkAuthPanel() {
  if (Platform.OS !== "web") {
    return (
      <View className="w-full max-w-[520px] items-center">
        <Text className="text-white text-base">Sign in is configured for web/desktop.</Text>
      </View>
    );
  }

  const clerkWeb = require("@clerk/clerk-react");
  const ClerkLoaded = clerkWeb.ClerkLoaded as any;
  const SignIn = clerkWeb.SignIn as any;

  return (
    <div className="w-full max-w-[520px] flex flex-col items-center">
      <Image
        source={require("../../../assets/moduo_logo_white.svg")}
        className="w-[280px] h-[70px] mb-6"
        contentFit="contain"
      />
      <ClerkLoaded>
        <SignIn
          routing="virtual"
          afterSignInUrl="/"
          afterSignUpUrl="/"
          appearance={{
            elements: {
              card: {
                background: "#ffffff",
                border: "1px solid #dbe2ef",
                boxShadow: "none",
              },
              headerTitle: { color: "#0f172a" },
              headerSubtitle: { color: "#64748b" },
              formFieldLabel: { color: "#1f2937" },
              formFieldInput: {
                background: "#ffffff",
                color: "#111827",
                border: "1px solid #cfd8e3",
              },
            },
          }}
        />
      </ClerkLoaded>
    </div>
  );
}
