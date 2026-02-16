import { useState } from "react";
import { Alert, Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/providers/auth-provider";

export default function AuthScreen() {
  const { configError } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    if (!email || !supabase) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email });
    setLoading(false);
    if (error) return Alert.alert("Sign in failed", error.message);
    setStep("code");
  };

  const verifyCode = async () => {
    if (!email || !code || !supabase) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setLoading(false);
    if (error) return Alert.alert("Code invalid", error.message);
  };

  return (
    <View flex={1} backgroundColor="#f6f7fb" paddingHorizontal="$5" alignItems="center" justifyContent="center">
      <View width="100%" maxWidth={420} gap="$4" padding="$5" borderRadius="$3" backgroundColor="#ffffff" borderWidth={1} borderColor="#dbe4f0">
        <Text fontSize="$6" fontWeight="700">
          Sign in
        </Text>
        <Text color="#64748b">Email-only login with magic code.</Text>
        {configError ? <Text color="#b91c1c">{configError}</Text> : null}
        <TextInput
          placeholder="you@company.com"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          style={{ borderWidth: 1, borderColor: "#dbe4f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
        />
        {step === "code" ? (
          <TextInput
            placeholder="6-digit code"
            keyboardType="number-pad"
            value={code}
            onChangeText={setCode}
            style={{ borderWidth: 1, borderColor: "#dbe4f0", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
          />
        ) : null}
        <View flexDirection="row" gap="$3">
          <Pressable
            style={{ flex: 1, backgroundColor: "#1d4ed8", borderRadius: 10, paddingVertical: 12, alignItems: "center", opacity: !!configError || loading || !email ? 0.5 : 1 }}
            disabled={!!configError || loading || !email}
            onPress={step === "email" ? sendCode : verifyCode}
          >
            <Text color="#ffffff">{step === "email" ? "Send code" : "Verify code"}</Text>
          </Pressable>
          {step === "code" ? (
            <Pressable
              style={{ borderWidth: 1, borderColor: "#dbe4f0", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 }}
              disabled={loading}
              onPress={() => setStep("email")}
            >
              <Text>Edit email</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
