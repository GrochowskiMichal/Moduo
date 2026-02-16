import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { supabase } from "../../src/lib/supabase";

export default function HomeScreen() {
  return (
    <View flex={1} backgroundColor="#f6f7fb" padding="$5" gap="$5">
      <View alignItems="flex-end">
        <Pressable
          style={{ borderWidth: 1, borderColor: "#dbe4f0", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, opacity: supabase ? 1 : 0.5 }}
          disabled={!supabase}
          onPress={() => supabase?.auth.signOut()}
        >
          <Text>Logout</Text>
        </Pressable>
      </View>
      <View flex={1} alignItems="center" justifyContent="center" gap="$2">
        <Text fontSize="$6" fontWeight="700">
          Authenticated App
        </Text>
        <Text color="#64748b">Protected route is active.</Text>
      </View>
    </View>
  );
}
