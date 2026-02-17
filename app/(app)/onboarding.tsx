import { useState } from "react";
import { router } from "expo-router";
import { Pressable, Text, TextInput, View } from "../../src/tw";
import { useAuth } from "../../src/providers/auth-provider";

export default function OnboardingScreen() {
  const { supabase, userId } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit = !!supabase && !!userId && !!firstName.trim() && !!lastName.trim() && !saving;

  const finishSetup = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const { error } = await supabase
      .from("users")
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        onboarding_completed: true,
      })
      .eq("id", userId!);
    setSaving(false);
    if (error) return;
    router.replace("/");
  };

  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="w-full max-w-[460px] rounded-2xl border border-[#1d2230] bg-[#0c1017] p-6 gap-3">
        <Text className="text-white text-[28px] font-semibold">Finish setup</Text>
        <Text className="text-[#8b95a8] text-[16px] mb-2">
          Add your first and last name to continue.
        </Text>
        <TextInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First name"
          placeholderTextColor="#637086"
          className="h-12 rounded-xl border border-[#232a3b] bg-[#0f1520] px-4 text-white"
        />
        <TextInput
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last name"
          placeholderTextColor="#637086"
          className="h-12 rounded-xl border border-[#232a3b] bg-[#0f1520] px-4 text-white"
        />
        <Pressable
          onPress={finishSetup}
          disabled={!canSubmit}
          className={`mt-2 h-12 rounded-xl items-center justify-center ${canSubmit ? "bg-white" : "bg-white/40"}`}
        >
          <Text className="text-[#0b1018] font-semibold text-[17px]">
            {saving ? "Saving..." : "Continue"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
